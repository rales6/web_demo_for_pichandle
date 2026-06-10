(function () {
  "use strict";

  const PRECISION_LEVELS = {
    1: { columns: 3, rows: 2 },
    2: { columns: 3, rows: 3 },
    3: { columns: 4, rows: 3 },
    4: { columns: 5, rows: 4 },
    5: { columns: 6, rows: 5 },
  };

  const SIZE_SEARCH_LEVELS = {
    1: [0.92, 1, 1.08],
    2: [0.82, 1, 1.2],
    3: [0.7, 1, 1.35],
    4: [0.58, 0.78, 1, 1.25, 1.5],
    5: [0.45, 0.7, 1, 1.35, 1.75],
  };

  function clampLevel(value) {
    return Math.max(1, Math.min(5, Math.round(Number(value) || 3)));
  }

  function canvasToBlob(canvas, type = "image/jpeg", quality = 0.86) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("候选合成图生成失败"));
        }
      }, type, quality);
    });
  }

  function healthUrlFromEndpoint(endpoint) {
    const url = new URL(endpoint, window.location.href);
    url.pathname = "/health";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  async function checkBackend(endpoint, timeoutMs = 6000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const healthUrl = healthUrlFromEndpoint(endpoint);

    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(`OPA 健康检查返回 HTTP ${response.status}`);
      }
      if (data.status !== "ok") {
        throw new Error(`OPA 服务已启动，但模型状态为 ${data.status || "未知"}`);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`OPA 服务连接超时：${healthUrl}`);
      }
      if (error instanceof TypeError) {
        throw new Error(
          `无法连接 OPA 服务 ${healthUrl}。请确认后端已启动，并检查浏览器跨域或网络限制`,
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function buildPositions(width, height, foregroundWidth, foregroundHeight, precisionLevel) {
    const { columns, rows } = PRECISION_LEVELS[clampLevel(precisionLevel)];
    const maxX = Math.max(0, width - foregroundWidth);
    const maxY = Math.max(0, height - foregroundHeight);
    const positions = [];

    for (let row = 0; row < rows; row += 1) {
      const yRatio = rows === 1 ? 0.5 : row / (rows - 1);
      for (let column = 0; column < columns; column += 1) {
        const xRatio = columns === 1 ? 0.5 : column / (columns - 1);
        positions.push({
          x: maxX * xRatio,
          y: maxY * yRatio,
        });
      }
    }

    return positions;
  }

  function createCandidateCanvas({
    background,
    foreground,
    outputWidth,
    outputHeight,
    placement,
    previewScale,
  }) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(outputWidth * previewScale));
    canvas.height = Math.max(1, Math.round(outputHeight * previewScale));
    const context = canvas.getContext("2d");

    context.drawImage(background, 0, 0, canvas.width, canvas.height);
    context.drawImage(
      foreground,
      placement.x * previewScale,
      placement.y * previewScale,
      placement.w * previewScale,
      placement.h * previewScale,
    );
    return canvas;
  }

  async function predictCandidates({ candidates, endpoint, timeoutMs, onProgress }) {
    const formData = new FormData();

    for (let index = 0; index < candidates.length; index += 1) {
      onProgress?.({
        phase: "render",
        completed: index + 1,
        total: candidates.length,
      });
      const blob = await canvasToBlob(candidates[index].canvas);
      formData.append("images", blob, `placement-${String(index).padStart(3, "0")}.jpg`);
    }

    onProgress?.({
      phase: "predict",
      completed: 0,
      total: candidates.length,
    });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.code !== 0 || !Array.isArray(data.scores)) {
        throw new Error(
          data.detail ||
            data.message ||
            `OPA 评分接口返回 HTTP ${response.status}`,
        );
      }
      return data.scores;
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(`OPA 评分请求超时，当前候选数量为 ${candidates.length}`);
      }
      if (error instanceof TypeError) {
        throw new Error(
          `浏览器无法访问 OPA 评分接口 ${endpoint}。请检查后端、CORS 和网页协议`,
        );
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function search(options) {
    const {
      background,
      foreground,
      outputWidth,
      outputHeight,
      baseForegroundWidth,
      precisionLevel = 3,
      sizeLevel = 3,
      endpoint = "http://127.0.0.1:8000/api/predict",
      timeoutMs = 300000,
      onProgress,
    } = options;

    if (!background || !foreground || !outputWidth || !outputHeight) {
      throw new Error("OPA 搜索缺少背景图、前景图或画布尺寸");
    }

    onProgress?.({ phase: "health", completed: 0, total: 0 });
    await checkBackend(endpoint);

    const aspect = foreground.height / foreground.width;
    const previewScale = Math.min(1, 448 / outputWidth, 448 / outputHeight);
    const sizeFactors = SIZE_SEARCH_LEVELS[clampLevel(sizeLevel)];
    const candidates = [];
    const usedSizes = new Set();

    for (const sizeFactor of sizeFactors) {
      const desiredWidth = Math.max(16, baseForegroundWidth * sizeFactor);
      const desiredHeight = Math.max(16, desiredWidth * aspect);
      const fitScale = Math.min(
        1,
        outputWidth / desiredWidth,
        outputHeight / desiredHeight,
      );
      const foregroundWidth = desiredWidth * fitScale;
      const foregroundHeight = desiredHeight * fitScale;
      const sizeKey = `${Math.round(foregroundWidth)}x${Math.round(foregroundHeight)}`;
      if (usedSizes.has(sizeKey)) continue;
      usedSizes.add(sizeKey);

      const positions = buildPositions(
        outputWidth,
        outputHeight,
        foregroundWidth,
        foregroundHeight,
        precisionLevel,
      );
      for (const position of positions) {
        const placement = {
          x: position.x,
          y: position.y,
          w: foregroundWidth,
          h: foregroundHeight,
        };
        candidates.push({
          placement,
          sizeFactor,
          canvas: createCandidateCanvas({
            background,
            foreground,
            outputWidth,
            outputHeight,
            placement,
            previewScale,
          }),
        });
      }
    }

    const scores = await predictCandidates({
      candidates,
      endpoint,
      timeoutMs,
      onProgress,
    });
    if (scores.length !== candidates.length) {
      throw new Error("OPA 返回的评分数量与候选图数量不一致");
    }

    let bestIndex = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if (Number(scores[index]) > Number(scores[bestIndex])) bestIndex = index;
    }

    onProgress?.({
      phase: "done",
      completed: candidates.length,
      total: candidates.length,
    });

    return {
      ...candidates[bestIndex].placement,
      score: Number(scores[bestIndex]),
      candidateCount: candidates.length,
      searchedSizeCount: usedSizes.size,
      selectedSizeFactor: candidates[bestIndex].sizeFactor,
      precisionLevel: clampLevel(precisionLevel),
      sizeLevel: clampLevel(sizeLevel),
    };
  }

  window.OPAPlacement = {
    search,
    checkBackend,
    precisionLevels: PRECISION_LEVELS,
    sizeSearchLevels: SIZE_SEARCH_LEVELS,
  };
})();
