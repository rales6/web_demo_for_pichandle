import argparse
import csv
import math
import os
import random
import time
from pathlib import Path

# MindSpore 日志等级：2 通常可以减少无关日志
os.environ.setdefault("GLOG_v", "2")

import mindspore as ms
import mindspore.dataset as ds
import mindspore.nn as nn
import mindspore.ops as ops
import numpy as np
from PIL import Image

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

# ImageNet 预训练模型常用归一化参数
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Train a MindSpore ResNet regressor that scores OPA placement from 0 to 100."
    )

    # 数据相关
    parser.add_argument("--data-root", type=Path, default=Path("../smart_image_app/OPA/new_OPA"), help="OPA dataset root.")
    parser.add_argument("--train-csv", type=Path, default=None, help="Train csv path. Defaults to data-root/train_set.csv.")
    parser.add_argument("--val-csv", type=Path, default=None, help="Validation csv path. Defaults to data-root/test_set.csv.")
    parser.add_argument("--score-column", default=None, help="CSV column containing a 0-100 score.")
    parser.add_argument("--label-column", default="label", help="Fallback binary label column.")
    parser.add_argument("--image-column", default="img_name", help="CSV column containing the composite image path.")
    parser.add_argument("--image-size", type=int, default=224)
    parser.add_argument(
        "--max-train-samples",
        type=int,
        default=10000,
        help="Maximum number of training samples. Default: 10000. Use -1 to use all samples.",
    )
    parser.add_argument(
        "--max-val-samples",
        type=int,
        default=None,
        help="Maximum number of validation samples. Use -1 to use all samples.",
    )

    # 模型相关
    parser.add_argument("--arch", default="resnet18", choices=["resnet18", "resnet34", "resnet50"])
    parser.add_argument(
        "--pretrained-ckpt",
        type=Path,
        default=None,
        help="Load a pretrained .ckpt before training. Incompatible keys, such as fc weight, can be skipped.",
    )
    parser.add_argument(
        "--resume",
        type=Path,
        default=None,
        help="Resume training from a full training checkpoint. Usually use output-dir/last.ckpt.",
    )
    parser.add_argument(
        "--strict-load",
        action="store_true",
        help="Strictly load every checkpoint parameter. If not set, incompatible parameters are skipped.",
    )

    # 训练相关
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--num-workers", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output-dir", type=Path, default=Path("runs/opa_score_resnet_ms"))

    # Ascend/NPU/华为云相关
    parser.add_argument("--device-target", default="Ascend", choices=["Ascend", "GPU", "CPU"])
    parser.add_argument("--device-id", type=int, default=0, help="Ascend/GPU device id. Huawei Cloud NPU often starts from 0.")
    parser.add_argument("--context-mode", default="GRAPH", choices=["GRAPH", "PYNATIVE"])
    parser.add_argument(
        "--sink-mode",
        action="store_true",
        help="Use dataset sink mode. For this custom loop, default is False because tqdm/logging is clearer.",
    )

    # 日志和保存
    parser.add_argument("--log-csv", type=Path, default=None, help="CSV log path. Defaults to output-dir/train_log.csv.")
    parser.add_argument(
        "--save-every-steps",
        type=int,
        default=200,
        help="Save latest_step.ckpt every N training batches. Use 0 to disable.",
    )
    parser.add_argument(
        "--print-every",
        type=int,
        default=10,
        help="When tqdm is unavailable, print progress every N batches.",
    )

    return parser.parse_args()


class SimpleProgress:
    """当环境没有安装 tqdm 时，使用这个简易进度显示。"""

    def __init__(self, total, desc, unit="it", print_every=10):
        self.total = int(total)
        self.desc = desc
        self.unit = unit
        self.count = 0
        self.print_every = max(1, int(print_every))

    def __enter__(self):
        print(f"{self.desc}: 0/{self.total} {self.unit}", flush=True)
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            print(f"{self.desc}: {self.count}/{self.total} {self.unit}", flush=True)

    def update(self, n=1):
        self.count += n
        if self.count == self.total or self.count % self.print_every == 0:
            print(f"{self.desc}: {self.count}/{self.total} {self.unit}", flush=True)

    def set_postfix(self, values):
        if self.count % self.print_every == 0:
            text = " ".join(f"{key}={value}" for key, value in values.items())
            print(f"{self.desc}: {self.count}/{self.total} {self.unit} {text}", flush=True)


def get_progress(total=None, desc="", unit="it", print_every=10):
    """优先用 tqdm 实时显示训练进度；没有 tqdm 时自动降级。"""
    if tqdm is not None:
        return tqdm(total=total, desc=desc, unit=unit)
    return SimpleProgress(total or 0, desc, unit, print_every=print_every)


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    ms.set_seed(seed)


def positive_or_none(value):
    """命令行中传 -1 表示不限制样本数量。"""
    if value is None:
        return None
    if value < 0:
        return None
    return value


def resolve_image_path(data_root, csv_path_value):
    """
    尽量兼容不同 CSV 写法：
    1. 绝对路径
    2. data_root / CSV 中的相对路径
    3. CSV 中带 dataset 前缀
    4. data_root/composite/图片名
    5. data_root/composite/train_set/图片名 或 test_set/图片名
    """
    raw_path = Path(str(csv_path_value))
    candidates = []

    if raw_path.is_absolute():
        candidates.append(raw_path)
    else:
        candidates.append(data_root / raw_path)

        parts = raw_path.parts
        if parts and parts[0] == "dataset":
            candidates.append(data_root / Path(*parts[1:]))

        candidates.append(data_root / "composite" / raw_path.name)
        if "train_set" in parts:
            candidates.append(data_root / "composite" / "train_set" / raw_path.name)
        if "test_set" in parts:
            candidates.append(data_root / "composite" / "test_set" / raw_path.name)

    for candidate in candidates:
        if candidate.exists():
            return candidate

    raise FileNotFoundError(f"Image not found for csv value: {csv_path_value}")


def normalize_score(row, score_column, label_column):
    """
    如果 CSV 有 0-100 分数列，就用 score-column；
    否则把二分类 label 映射成 0 或 100。
    """
    if score_column:
        score = float(row[score_column])
    else:
        score = 100.0 if int(row[label_column]) == 1 else 0.0
    return max(0.0, min(100.0, score))


def resize_and_normalize(image_path, image_size, training):
    image = Image.open(image_path).convert("RGB").resize((image_size, image_size), Image.BILINEAR)
    if training and random.random() < 0.5:
        image = image.transpose(Image.FLIP_LEFT_RIGHT)

    array = np.asarray(image, dtype=np.float32) / 255.0
    array = array.transpose(2, 0, 1)
    array = (array - IMAGENET_MEAN) / IMAGENET_STD
    return array.astype(np.float32)


class OPAScoreGenerator:
    def __init__(
        self,
        csv_path,
        data_root,
        image_size,
        training,
        image_column,
        score_column,
        label_column,
        max_samples=None,
        print_every=10,
    ):
        self.image_size = image_size
        self.training = training
        self.samples = []

        csv_path = Path(csv_path)
        data_root = Path(data_root)
        if not csv_path.exists():
            raise FileNotFoundError(f"CSV does not exist: {csv_path}")

        print(f"Loading csv: {csv_path}", flush=True)
        with csv_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)

        if image_column not in reader.fieldnames:
            raise KeyError(f"Image column '{image_column}' not found in {csv_path}. CSV columns: {reader.fieldnames}")
        if score_column and score_column not in reader.fieldnames:
            raise KeyError(f"Score column '{score_column}' not found in {csv_path}. CSV columns: {reader.fieldnames}")
        if not score_column and label_column not in reader.fieldnames:
            raise KeyError(f"Label column '{label_column}' not found in {csv_path}. CSV columns: {reader.fieldnames}")

        max_samples = positive_or_none(max_samples)
        if max_samples is not None and max_samples < len(rows):
            print(f"Sampling {max_samples} rows from {len(rows)} rows.", flush=True)
            rows = random.sample(rows, max_samples)

        with get_progress(total=len(rows), desc="Resolving image paths", unit="row", print_every=print_every) as bar:
            for row in rows:
                image_path = resolve_image_path(data_root, row[image_column])
                if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                    bar.update(1)
                    continue
                score = normalize_score(row, score_column, label_column)
                self.samples.append((image_path, np.array([score], dtype=np.float32)))
                bar.update(1)

        if not self.samples:
            raise RuntimeError(f"No samples found in {csv_path}")
        print(f"Loaded samples: {len(self.samples)}", flush=True)

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        image_path, score = self.samples[index]
        image = resize_and_normalize(image_path, self.image_size, self.training)
        return image, score


def make_dataset(generator, batch_size, shuffle, num_workers):
    # GeneratorDataset 对 Python/PIL 读取比较敏感，过多 worker 有时会引入调试困难。
    safe_workers = max(1, min(int(num_workers), 8))
    dataset = ds.GeneratorDataset(
        source=generator,
        column_names=["image", "score"],
        shuffle=shuffle,
        num_parallel_workers=safe_workers,
    )
    return dataset.batch(batch_size, drop_remainder=False)


def conv3x3(in_channels, out_channels, stride=1):
    return nn.Conv2d(
        in_channels,
        out_channels,
        kernel_size=3,
        stride=stride,
        pad_mode="pad",
        padding=1,
        has_bias=False,
    )


def conv1x1(in_channels, out_channels, stride=1):
    return nn.Conv2d(
        in_channels,
        out_channels,
        kernel_size=1,
        stride=stride,
        pad_mode="pad",
        padding=0,
        has_bias=False,
    )


class BasicBlock(nn.Cell):
    expansion = 1

    def __init__(self, in_channels, channels, stride=1, downsample=None):
        super().__init__()
        self.conv1 = conv3x3(in_channels, channels, stride)
        self.bn1 = nn.BatchNorm2d(channels)
        self.relu = nn.ReLU()
        self.conv2 = conv3x3(channels, channels)
        self.bn2 = nn.BatchNorm2d(channels)
        self.downsample = downsample

    def construct(self, x):
        identity = x

        out = self.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))

        if self.downsample is not None:
            identity = self.downsample(x)

        out = self.relu(out + identity)
        return out


class Bottleneck(nn.Cell):
    expansion = 4

    def __init__(self, in_channels, channels, stride=1, downsample=None):
        super().__init__()
        width = channels
        self.conv1 = conv1x1(in_channels, width)
        self.bn1 = nn.BatchNorm2d(width)
        self.conv2 = conv3x3(width, width, stride)
        self.bn2 = nn.BatchNorm2d(width)
        self.conv3 = conv1x1(width, channels * self.expansion)
        self.bn3 = nn.BatchNorm2d(channels * self.expansion)
        self.relu = nn.ReLU()
        self.downsample = downsample

    def construct(self, x):
        identity = x

        out = self.relu(self.bn1(self.conv1(x)))
        out = self.relu(self.bn2(self.conv2(out)))
        out = self.bn3(self.conv3(out))

        if self.downsample is not None:
            identity = self.downsample(x)

        out = self.relu(out + identity)
        return out


class ScoreResNet(nn.Cell):
    def __init__(self, block, layers):
        super().__init__()
        self.in_channels = 64

        self.conv1 = nn.Conv2d(3, 64, kernel_size=7, stride=2, pad_mode="pad", padding=3, has_bias=False)
        self.bn1 = nn.BatchNorm2d(64)
        self.relu = nn.ReLU()
        self.maxpool = nn.MaxPool2d(kernel_size=3, stride=2, pad_mode="same")

        self.layer1 = self._make_layer(block, 64, layers[0])
        self.layer2 = self._make_layer(block, 128, layers[1], stride=2)
        self.layer3 = self._make_layer(block, 256, layers[2], stride=2)
        self.layer4 = self._make_layer(block, 512, layers[3], stride=2)

        self.avgpool = nn.AdaptiveAvgPool2d((1, 1))
        self.flatten = nn.Flatten()

        # Regress one score. Head input is 512 for ResNet18/34 and 2048 for ResNet50.
        self.head = nn.SequentialCell([
            nn.Dense(512 * block.expansion, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Dense(256, 1),
        ])
        self.sigmoid = ops.Sigmoid()

    def _make_layer(self, block, channels, blocks, stride=1):
        downsample = None
        out_channels = channels * block.expansion

        if stride != 1 or self.in_channels != out_channels:
            downsample = nn.SequentialCell(
                [conv1x1(self.in_channels, out_channels, stride), nn.BatchNorm2d(out_channels)]
            )

        layers = [block(self.in_channels, channels, stride, downsample)]
        self.in_channels = out_channels

        for _ in range(1, blocks):
            layers.append(block(self.in_channels, channels))

        return nn.SequentialCell(layers)

    def construct(self, x):
        x = self.relu(self.bn1(self.conv1(x)))
        x = self.maxpool(x)

        x = self.layer1(x)
        x = self.layer2(x)
        x = self.layer3(x)
        x = self.layer4(x)

        x = self.avgpool(x)
        x = self.flatten(x)
        x = self.head(x)

        return self.sigmoid(x) * 100.0


def build_model(arch):
    configs = {
        "resnet18": (BasicBlock, [2, 2, 2, 2]),
        "resnet34": (BasicBlock, [3, 4, 6, 3]),
        "resnet50": (Bottleneck, [3, 4, 6, 3]),
    }
    block, layers = configs[arch]
    return ScoreResNet(block, layers)


def set_context(args):
    mode = ms.GRAPH_MODE if args.context_mode == "GRAPH" else ms.PYNATIVE_MODE

    # 支持华为云 Ascend NPU：device-target=Ascend，device-id 通常为 0。
    # 如果是 ModelArts/Ascend 环境，MindSpore 需要安装 Ascend 版本。
    try:
        ms.set_context(mode=mode, device_target=args.device_target, device_id=args.device_id)
    except TypeError:
        # 有些 CPU 环境不接受 device_id 参数
        ms.set_context(mode=mode, device_target=args.device_target)


def load_checkpoint_flexible(network, ckpt_path, strict=False):
    """
    加载 .ckpt。
    strict=False 时会自动跳过名称不存在或 shape 不匹配的参数。
    这对“ImageNet 预训练 ResNet + 自己的 fc 回归头”很有用。
    """
    ckpt_path = Path(ckpt_path)
    if not ckpt_path.exists():
        raise FileNotFoundError(f"Checkpoint not found: {ckpt_path}")

    print(f"Loading checkpoint: {ckpt_path}", flush=True)
    param_dict = ms.load_checkpoint(str(ckpt_path))

    if strict:
        not_loaded = ms.load_param_into_net(network, param_dict)
        print(f"Strict load finished. Not loaded: {not_loaded}", flush=True)
        return

    net_params = {p.name: p for p in network.get_parameters()}
    filtered = {}
    skipped = []

    for name, value in param_dict.items():
        if name not in net_params:
            skipped.append((name, "name_not_found"))
            continue
        if tuple(value.shape) != tuple(net_params[name].shape):
            skipped.append((name, f"shape_mismatch ckpt={tuple(value.shape)} net={tuple(net_params[name].shape)}"))
            continue
        filtered[name] = value

    not_loaded = ms.load_param_into_net(network, filtered)
    print(f"Loaded parameters: {len(filtered)}", flush=True)
    print(f"Skipped parameters: {len(skipped)}", flush=True)
    if skipped:
        print("First skipped parameters:", flush=True)
        for item in skipped[:10]:
            print(f"  {item[0]}: {item[1]}", flush=True)
    if not_loaded:
        print(f"Not loaded by MindSpore: {not_loaded}", flush=True)


def append_csv_log(log_csv, row):
    log_csv = Path(log_csv)
    log_csv.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "epoch",
        "train_loss",
        "train_mae",
        "val_loss",
        "val_mae",
        "best_mae",
        "lr",
        "epoch_seconds",
        "is_best",
    ]

    file_exists = log_csv.exists()
    with log_csv.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


def train_epoch(network, dataset, loss_fn, optimizer, epoch, output_dir, save_every_steps, print_every):
    network.set_train(True)

    def forward_fn(images, scores):
        predictions = network(images)
        loss = loss_fn(predictions, scores)
        return loss, predictions

    grad_fn = ms.value_and_grad(forward_fn, None, optimizer.parameters, has_aux=True)

    def train_step(images, scores):
        (loss, predictions), grads = grad_fn(images, scores)
        optimizer(grads)
        return loss, predictions

    total_loss = 0.0
    total_abs_error = 0.0
    total_count = 0
    num_batches = dataset.get_dataset_size()

    with get_progress(total=num_batches, desc=f"Epoch {epoch} Training", unit="batch", print_every=print_every) as bar:
        for step, batch in enumerate(dataset.create_dict_iterator(), start=1):
            images = batch["image"]
            scores = batch["score"]

            loss, predictions = train_step(images, scores)

            batch_size = int(images.shape[0])
            abs_error = ops.abs(predictions - scores)
            batch_mae = float(abs_error.mean().asnumpy())

            total_loss += float(loss.asnumpy()) * batch_size
            total_abs_error += float(abs_error.sum().asnumpy())
            total_count += batch_size

            bar.set_postfix({"loss": f"{float(loss.asnumpy()):.4f}", "mae": f"{batch_mae:.2f}"})
            bar.update(1)

            if save_every_steps > 0 and step % save_every_steps == 0:
                ms.save_checkpoint(network, str(output_dir / "latest_step.ckpt"))
                print(f"Saved step checkpoint: epoch={epoch} step={step}", flush=True)

    return {
        "loss": total_loss / max(total_count, 1),
        "mae": total_abs_error / max(total_count, 1),
    }


def evaluate(network, dataset, loss_fn, epoch, print_every):
    network.set_train(False)

    total_loss = 0.0
    total_abs_error = 0.0
    total_count = 0
    num_batches = dataset.get_dataset_size()

    with get_progress(total=num_batches, desc=f"Epoch {epoch} Validating", unit="batch", print_every=print_every) as bar:
        for batch in dataset.create_dict_iterator():
            images = batch["image"]
            scores = batch["score"]

            predictions = network(images)
            loss = loss_fn(predictions, scores)

            batch_size = int(images.shape[0])
            abs_error = ops.abs(predictions - scores)

            total_loss += float(loss.asnumpy()) * batch_size
            total_abs_error += float(abs_error.sum().asnumpy())
            total_count += batch_size

            bar.update(1)

    return {
        "loss": total_loss / max(total_count, 1),
        "mae": total_abs_error / max(total_count, 1),
    }


def main():
    args = parse_args()
    seed_everything(args.seed)
    set_context(args)

    data_root = args.data_root
    train_csv = args.train_csv or data_root / "train_set.csv"
    val_csv = args.val_csv or data_root / "test_set.csv"
    log_csv = args.log_csv or args.output_dir / "train_log.csv"

    args.output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 70, flush=True)
    print("Training configuration", flush=True)
    print("=" * 70, flush=True)
    print(f"Data root: {data_root} | exists={data_root.exists()}", flush=True)
    print(f"Train CSV: {train_csv} | exists={train_csv.exists()}", flush=True)
    print(f"Val CSV: {val_csv} | exists={val_csv.exists()}", flush=True)
    print(f"Output dir: {args.output_dir}", flush=True)
    print(f"CSV log: {log_csv}", flush=True)
    print(f"Device target: {args.device_target} | device_id={args.device_id} | context={args.context_mode}", flush=True)
    print(f"Arch: {args.arch} | epochs={args.epochs} | batch_size={args.batch_size}", flush=True)
    print(f"Max train samples: {args.max_train_samples}", flush=True)
    print(f"Pretrained ckpt: {args.pretrained_ckpt}", flush=True)
    print(f"Resume ckpt: {args.resume}", flush=True)
    print(f"Save every steps: {args.save_every_steps}", flush=True)
    print("=" * 70, flush=True)

    train_generator = OPAScoreGenerator(
        csv_path=train_csv,
        data_root=data_root,
        image_size=args.image_size,
        training=True,
        image_column=args.image_column,
        score_column=args.score_column,
        label_column=args.label_column,
        max_samples=args.max_train_samples,
        print_every=args.print_every,
    )

    val_generator = OPAScoreGenerator(
        csv_path=val_csv,
        data_root=data_root,
        image_size=args.image_size,
        training=False,
        image_column=args.image_column,
        score_column=args.score_column,
        label_column=args.label_column,
        max_samples=args.max_val_samples,
        print_every=args.print_every,
    )

    train_dataset = make_dataset(train_generator, args.batch_size, True, args.num_workers)
    val_dataset = make_dataset(val_generator, args.batch_size, False, args.num_workers)

    print(
        f"Train samples: {len(train_generator)} | Train batches: {train_dataset.get_dataset_size()}",
        flush=True,
    )
    print(
        f"Val samples: {len(val_generator)} | Val batches: {val_dataset.get_dataset_size()}",
        flush=True,
    )

    network = build_model(args.arch)
    print(
        "Model structure: ResNet backbone + MLP head. "
        "ResNet18 + MLP Head is a new structure; do not load an old ResNet50 Dense-head best.ckpt. "
        "Please retrain to produce a matching best.ckpt.",
        flush=True,
    )

    # 先加载预训练权重，再加载 resume。resume 优先级更高。
    if args.pretrained_ckpt:
        load_checkpoint_flexible(network, args.pretrained_ckpt, strict=args.strict_load)

    if args.resume:
        load_checkpoint_flexible(network, args.resume, strict=args.strict_load)

    loss_fn = nn.SmoothL1Loss(beta=10.0, reduction="mean")
    optimizer = nn.AdamWeightDecay(network.trainable_params(), learning_rate=args.lr, weight_decay=args.weight_decay)

    ms.save_checkpoint(network, str(args.output_dir / "init.ckpt"))
    print(f"Initial checkpoint saved to: {args.output_dir / 'init.ckpt'}", flush=True)

    best_mae = math.inf
    print("Output: 0-100 placement score", flush=True)

    for epoch in range(1, args.epochs + 1):
        print(f"\nEpoch {epoch}/{args.epochs}", flush=True)
        epoch_start = time.time()

        train_metrics = train_epoch(
            network=network,
            dataset=train_dataset,
            loss_fn=loss_fn,
            optimizer=optimizer,
            epoch=epoch,
            output_dir=args.output_dir,
            save_every_steps=args.save_every_steps,
            print_every=args.print_every,
        )

        val_metrics = evaluate(
            network=network,
            dataset=val_dataset,
            loss_fn=loss_fn,
            epoch=epoch,
            print_every=args.print_every,
        )

        is_best = val_metrics["mae"] < best_mae
        if is_best:
            best_mae = val_metrics["mae"]
            ms.save_checkpoint(network, str(args.output_dir / "best.ckpt"))

        ms.save_checkpoint(network, str(args.output_dir / "last.ckpt"))

        epoch_seconds = time.time() - epoch_start

        append_csv_log(
            log_csv,
            {
                "epoch": epoch,
                "train_loss": f"{train_metrics['loss']:.6f}",
                "train_mae": f"{train_metrics['mae']:.6f}",
                "val_loss": f"{val_metrics['loss']:.6f}",
                "val_mae": f"{val_metrics['mae']:.6f}",
                "best_mae": f"{best_mae:.6f}",
                "lr": args.lr,
                "epoch_seconds": f"{epoch_seconds:.2f}",
                "is_best": int(is_best),
            },
        )

        print(
            f"Epoch {epoch:03d}/{args.epochs:03d} "
            f"train_loss={train_metrics['loss']:.4f} train_mae={train_metrics['mae']:.2f} "
            f"val_loss={val_metrics['loss']:.4f} val_mae={val_metrics['mae']:.2f} "
            f"best_mae={best_mae:.2f} "
            f"time={epoch_seconds:.1f}s",
            flush=True,
        )
        print(f"CSV log updated: {log_csv}", flush=True)

    print(f"\nBest checkpoint saved to: {args.output_dir / 'best.ckpt'}", flush=True)
    print(f"Last checkpoint saved to: {args.output_dir / 'last.ckpt'}", flush=True)
    print(f"Training log saved to: {log_csv}", flush=True)


if __name__ == "__main__":
    main()
