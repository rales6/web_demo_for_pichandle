# OPA 后端 Render 部署包

这是用于部署到 Render 的 FastAPI + MindSpore 后端项目。

## 1. 文件结构

```text
render_backend_ready/
├── app.py
├── requirements.txt
├── train_opa_score_resnet_ms.py
├── best.ckpt
├── render.yaml
├── .gitignore
├── setup_opa_env.ps1          # 可选，本地 Windows 创建虚拟环境
├── start_opa_backend.ps1      # 可选，本地 Windows 启动后端
└── README_RENDER_DEPLOY.md
```

真正给 Render 使用的是：

```text
app.py
requirements.txt
train_opa_score_resnet_ms.py
best.ckpt
render.yaml
```

两个 `.ps1` 文件只用于 Windows 本地调试，Render 不执行它们。

## 2. 上传 GitHub

1. 在 GitHub 新建一个公开仓库，例如：`opa-backend-api`。
2. 解压本压缩包。
3. 把解压出来的所有文件直接上传到仓库根目录。
4. 不要上传 `.venv/` 虚拟环境。

正确结构应该是：

```text
opa-backend-api/
├── app.py
├── requirements.txt
├── train_opa_score_resnet_ms.py
├── best.ckpt
├── render.yaml
└── .gitignore
```

不要变成：

```text
opa-backend-api/
└── render_backend_ready/
    ├── app.py
    └── requirements.txt
```

`app.py` 必须在 GitHub 仓库根目录。

## 3. Render 部署方法

进入 Render：

```text
New → Web Service → 连接 GitHub 仓库 opa-backend-api
```

如果 Render 自动识别 `render.yaml`，可以直接按提示创建服务。

如果手动填写，配置如下：

```text
Runtime: Python 3
Build Command: pip install -r requirements.txt
Start Command: python app.py --host 0.0.0.0 --train-code train_opa_score_resnet_ms.py --ckpt best.ckpt --arch resnet18 --device-target CPU
```

## 4. 部署成功后测试

假设 Render 给你的地址是：

```text
https://opa-backend-api.onrender.com
```

先测试健康检查：

```text
https://opa-backend-api.onrender.com/health
```

正常会返回：

```json
{
  "status": "ok",
  "model": {
    "arch": "resnet18",
    "image_size": 224,
    "device_target": "CPU",
    "output": "0-100 placement score"
  }
}
```

## 5. 前端需要修改

前端 GitHub Pages 里的 API 地址不要再写：

```javascript
http://127.0.0.1:8000
```

要改成 Render 的公网地址，例如：

```javascript
const API_BASE = "https://opa-backend-api.onrender.com";
```

然后前端调用：

```javascript
fetch(`${API_BASE}/api/predict`, {
  method: "POST",
  body: formData
});
```

## 6. 本地 Windows 调试

本地调试可以使用：

```powershell
.\setup_opa_env.ps1
.\start_opa_backend.ps1
```

本地地址：

```text
http://127.0.0.1:8000
```

## 7. 注意事项

- Render 运行的是 Linux 环境，所以不会执行 `.ps1`。
- `.venv/` 不上传，Render 会根据 `requirements.txt` 重新安装依赖。
- 如果 `mindspore` 安装失败，说明 Render 的免费 Python 环境不适配当前 MindSpore 版本，建议改用 Docker / HuggingFace Spaces / 云服务器 Ubuntu 部署。
- `best.ckpt` 大约 43MB，可以放 GitHub；如果后续模型很大，建议用 Git LFS 或云存储。
