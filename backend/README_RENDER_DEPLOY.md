# Render 后端部署说明

本目录用于部署 FastAPI + MindSpore 后端。

## 重要

`best.ckpt` 模型文件未包含在压缩包中，请使用 Git LFS 上传到：

```text
backend/best.ckpt
```

## Render 配置

如果后端放在当前 GitHub 仓库的 `backend/` 文件夹中：

```text
Root Directory: backend
Build Command: pip install -r requirements.txt
Start Command: python app.py --host 0.0.0.0 --train-code train_opa_score_resnet_ms.py --ckpt best.ckpt --arch resnet18 --device-target CPU
```

部署成功后测试：

```text
https://你的服务名.onrender.com/health
```

前端 `app.js` 里把 API 地址改为：

```javascript
endpoint: "https://你的服务名.onrender.com/api/compose"
```
