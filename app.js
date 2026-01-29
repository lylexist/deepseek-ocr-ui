const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const previewPanel = document.getElementById("previewPanel");
const fileInfo = document.getElementById("fileInfo");
const promptInput = document.getElementById("promptInput");
const presetButtons = document.querySelectorAll(".preset");
const runBtn = document.getElementById("runBtn");
const output = document.getElementById("output");
const statusPill = document.getElementById("statusPill");
const endpointInput = document.getElementById("endpointInput");
const modelInput = document.getElementById("modelInput");
const streamToggle = document.getElementById("streamToggle");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const locateBtn = document.getElementById("locateBtn");
const latencyNote = document.getElementById("latencyNote");
const scrollToUpload = document.getElementById("scrollToUpload");
const loadSample = document.getElementById("loadSample");
const groundingModal = document.getElementById("groundingModal");
const closeGrounding = document.getElementById("closeGrounding");
const groundingImage = document.getElementById("groundingImage");
const groundingBoxes = document.getElementById("groundingBoxes");
const groundingList = document.getElementById("groundingList");

let currentImage = null;
let currentFilename = "ocr-result.md";
let groundingItems = [];
let activeGroundingIndex = -1;

const statusMap = {
  idle: "就绪",
  uploading: "上传中",
  running: "识别中",
  done: "完成",
  error: "出错",
};

function setStatus(state) {
  statusPill.textContent = statusMap[state] || "就绪";
  statusPill.dataset.state = state;
}

function setOutput(text) {
  output.textContent = text || "";
  refreshGroundingState();
}

function setPreview(dataUrl) {
  if (!dataUrl) {
    previewPanel.innerHTML = `
      <div class="placeholder">
        <div class="placeholder-icon"></div>
        <div>
          <div class="placeholder-title">拖拽或上传文档图片</div>
          <div class="placeholder-desc">支持 PNG / JPG / WebP</div>
        </div>
      </div>
    `;
    return;
  }
  previewPanel.innerHTML = `<img class="preview" src="${dataUrl}" alt="OCR 预览" />`;
}

function parseGroundingBlocks(text) {
  if (!text) return [];
  const regex =
    /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*<\|det\|>\s*\[\[(.*?)\]\]\s*<\|\/det\|>/g;
  const matches = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: regex.lastIndex,
      ref: match[1].trim(),
      det: match[2].trim(),
    });
  }

  return matches
    .map((item, index) => {
      const nextStart = matches[index + 1]?.start ?? text.length;
      const tail = text.slice(item.end, nextStart);
      const line =
        tail
          .split("\n")
          .map((value) => value.trim())
          .find((value) => value.length > 0) || "";
      const coords = item.det
        .split(/[,\s]+/)
        .filter((value) => value.length > 0)
        .map((value) => Number.parseFloat(value))
        .filter((value) => Number.isFinite(value));
      if (coords.length < 4) {
        return null;
      }
      return {
        label: item.ref || "text",
        text: line || item.ref || "识别文本",
        coords,
      };
    })
    .filter(Boolean);
}

function refreshGroundingState() {
  groundingItems = parseGroundingBlocks(output.textContent || "");
  locateBtn.disabled = !currentImage || groundingItems.length === 0;
  if (groundingItems.length === 0) {
    activeGroundingIndex = -1;
  }
}

function getCoordBounds(items) {
  let maxX = 0;
  let maxY = 0;
  items.forEach((item) => {
    const coords = item.coords || [];
    for (let i = 0; i < coords.length; i += 2) {
      const x = coords[i];
      const y = coords[i + 1];
      if (Number.isFinite(x)) maxX = Math.max(maxX, x);
      if (Number.isFinite(y)) maxY = Math.max(maxY, y);
    }
  });
  return { maxX, maxY };
}

function computeMapping(items, imageWidth, imageHeight) {
  const { maxX, maxY } = getCoordBounds(items);
  const maxVal = Math.max(maxX, maxY);
  if (!maxVal || !imageWidth || !imageHeight) {
    return { mode: "direct", baseSize: null, padX: 0, padY: 0, scale: 1 };
  }

  let spaceType = "pixel";
  if (maxVal <= 1.5) {
    spaceType = "normalized";
  } else if (maxVal <= 100) {
    spaceType = "percent";
  } else if (maxVal <= 1200) {
    spaceType = "bins1000";
  }

  const coordAspect = maxY ? maxX / maxY : 1;
  const imageAspect = imageWidth / imageHeight;
  const coordIsSquare = Math.abs(coordAspect - 1) <= 0.15;
  const imageIsSquare = Math.abs(imageAspect - 1) <= 0.2;
  const shouldLetterbox = coordIsSquare && !imageIsSquare;

  let baseSize = maxVal;
  if (spaceType === "normalized") {
    baseSize = 1;
  } else if (spaceType === "percent") {
    baseSize = 100;
  } else if (spaceType === "bins1000") {
    baseSize = 1000;
  } else {
    const candidates = [512, 640, 768, 896, 1024, 1280, 1536, 2048];
    baseSize = candidates.find((size) => size >= maxVal) || maxVal;
  }

  let padX = 0;
  let padY = 0;
  let scale = 1;
  if (shouldLetterbox) {
    if (imageWidth >= imageHeight) {
      scale = baseSize / imageWidth;
      const resizedHeight = imageHeight * scale;
      padY = (baseSize - resizedHeight) / 2;
    } else {
      scale = baseSize / imageHeight;
      const resizedWidth = imageWidth * scale;
      padX = (baseSize - resizedWidth) / 2;
    }
  }

  return { mode: shouldLetterbox ? "letterbox" : "direct", baseSize, padX, padY, scale, spaceType };
}

function updateGroundingBoxes() {
  if (!groundingImage.complete || !groundingItems.length) return;
  const mapping = computeMapping(
    groundingItems,
    groundingImage.naturalWidth,
    groundingImage.naturalHeight
  );
  const scaleX = groundingImage.clientWidth / groundingImage.naturalWidth;
  const scaleY = groundingImage.clientHeight / groundingImage.naturalHeight;
  const boxes = groundingBoxes.querySelectorAll(".grounding-box");

  groundingItems.forEach((item, index) => {
    const box = boxes[index];
    if (!box) return;
    const coords = item.coords;
    const boxCoords = normalizeBoxCoords(
      coords,
      groundingImage.naturalWidth,
      groundingImage.naturalHeight,
      mapping
    );
    const left = boxCoords.x1 * scaleX;
    const top = boxCoords.y1 * scaleY;
    const width = (boxCoords.x2 - boxCoords.x1) * scaleX;
    const height = (boxCoords.y2 - boxCoords.y1) * scaleY;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
  });
}

function normalizeBoxCoords(coords, imageWidth, imageHeight, mapping) {
  let xs = [];
  let ys = [];
  if (coords.length >= 8) {
    for (let i = 0; i < coords.length; i += 2) {
      xs.push(coords[i]);
      ys.push(coords[i + 1]);
    }
  } else {
    const ax1 = coords[0];
    const ay1 = coords[1];
    const ax2 = coords[2];
    const ay2 = coords[3];

    const cand1 = {
      x1: Math.min(ax1, ax2),
      y1: Math.min(ay1, ay2),
      x2: Math.max(ax1, ax2),
      y2: Math.max(ay1, ay2),
    };
    const cand2 = {
      x1: Math.min(ay1, ay2),
      y1: Math.min(ax1, ax2),
      x2: Math.max(ay1, ay2),
      y2: Math.max(ax1, ax2),
    };
    const w1 = cand1.x2 - cand1.x1;
    const h1 = cand1.y2 - cand1.y1;
    const w2 = cand2.x2 - cand2.x1;
    const h2 = cand2.y2 - cand2.y1;
    const ratio1 = h1 > 0 ? w1 / h1 : 0;
    const ratio2 = h2 > 0 ? w2 / h2 : 0;
    const chosen = ratio1 >= ratio2 ? cand1 : cand2;
    xs = [chosen.x1, chosen.x2];
    ys = [chosen.y1, chosen.y2];
  }
  let x1 = Math.min(...xs);
  let x2 = Math.max(...xs);
  let y1 = Math.min(...ys);
  let y2 = Math.max(...ys);

  const maxVal = Math.max(x2, y2);
  let baseSize = mapping?.baseSize;
  let spaceType = mapping?.spaceType;

  if (!spaceType) {
    if (maxVal <= 1.5) {
      spaceType = "normalized";
      baseSize = 1;
    } else if (maxVal <= 100) {
      spaceType = "percent";
      baseSize = 100;
    } else if (maxVal <= 1200) {
      spaceType = "bins1000";
      baseSize = 1000;
    } else {
      spaceType = "pixel";
      baseSize = maxVal;
    }
  }

  if (mapping?.mode === "letterbox") {
    if (spaceType === "normalized" || spaceType === "percent" || spaceType === "bins1000") {
      x1 = (x1 / baseSize) * mapping.baseSize;
      x2 = (x2 / baseSize) * mapping.baseSize;
      y1 = (y1 / baseSize) * mapping.baseSize;
      y2 = (y2 / baseSize) * mapping.baseSize;
    }
    x1 = (x1 - mapping.padX) / mapping.scale;
    x2 = (x2 - mapping.padX) / mapping.scale;
    y1 = (y1 - mapping.padY) / mapping.scale;
    y2 = (y2 - mapping.padY) / mapping.scale;
  } else if (spaceType === "normalized" || spaceType === "percent" || spaceType === "bins1000") {
    x1 = (x1 / baseSize) * imageWidth;
    x2 = (x2 / baseSize) * imageWidth;
    y1 = (y1 / baseSize) * imageHeight;
    y2 = (y2 / baseSize) * imageHeight;
  }

  return { x1, y1, x2, y2 };
}

function setActiveGrounding(index) {
  activeGroundingIndex = index;
  groundingList.querySelectorAll(".grounding-item").forEach((item, idx) => {
    item.classList.toggle("active", idx === index);
  });
  groundingBoxes.querySelectorAll(".grounding-box").forEach((box, idx) => {
    box.classList.toggle("active", idx === index);
  });
}

function renderGroundingModal() {
  groundingList.innerHTML = "";
  groundingBoxes.innerHTML = "";

  if (!groundingItems.length) {
    groundingList.innerHTML = `<div class="grounding-empty">暂无定位标签输出，请使用“转 Markdown”并开启定位信息。</div>`;
    return;
  }

  groundingItems.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "grounding-item";
    const title = document.createElement("div");
    title.className = "grounding-item-title";
    title.textContent = item.label || "text";
    const text = document.createElement("div");
    text.className = "grounding-item-text";
    text.textContent = item.text;
    card.append(title, text);
    card.addEventListener("click", () => {
      setActiveGrounding(index);
    });
    groundingList.appendChild(card);

    const box = document.createElement("div");
    box.className = "grounding-box";
    groundingBoxes.appendChild(box);
  });

  if (activeGroundingIndex >= 0) {
    setActiveGrounding(activeGroundingIndex);
  } else {
    setActiveGrounding(0);
  }
}

function openGroundingModal() {
  if (locateBtn.disabled) return;
  groundingModal.classList.add("open");
  groundingModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  groundingImage.src = currentImage || "";
  renderGroundingModal();
  if (groundingImage.complete) {
    updateGroundingBoxes();
  }
}

function closeGroundingModal() {
  groundingModal.classList.remove("open");
  groundingModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function updateFileInfo(file) {
  if (!file) {
    fileInfo.textContent = "尚未选择文件";
    return;
  }
  const sizeMb = (file.size / 1024 / 1024).toFixed(2);
  fileInfo.textContent = `${file.name} · ${sizeMb} MB`;
}

function setPrompt(prompt) {
  promptInput.value = prompt;
  presetButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.prompt === prompt);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("请上传图片文件");
    return;
  }
  setStatus("uploading");
  updateFileInfo(file);
  currentFilename = file.name.replace(/\.[^.]+$/, "") + ".md";

  try {
    const dataUrl = await readFileAsDataUrl(file);
    currentImage = dataUrl;
    setPreview(dataUrl);
    refreshGroundingState();
    setStatus("idle");
  } catch (err) {
    setStatus("error");
    alert(err.message);
  }
}

function getBase64FromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const parts = dataUrl.split(",");
  return parts.length > 1 ? parts[1] : null;
}

async function runOCR() {
  const endpoint = endpointInput.value.trim().replace(/\/$/, "");
  const model = modelInput.value.trim();
  const prompt = promptInput.value.trim();

  if (!currentImage) {
    alert("请先上传文档图片");
    return;
  }
  if (!endpoint || !model) {
    alert("请填写接口地址与模型 ID");
    return;
  }
  if (!prompt) {
    alert("请填写提示词");
    return;
  }

  const payload = {
    model,
    prompt,
    images: [getBase64FromDataUrl(currentImage)],
    stream: streamToggle.checked,
  };

  setStatus("running");
  setOutput("模型处理中…\n");
  latencyNote.textContent = "";

  const start = performance.now();
  try {
    if (payload.stream) {
      await runStream(endpoint, payload);
    } else {
      await runOnce(endpoint, payload);
    }
    const duration = ((performance.now() - start) / 1000).toFixed(2);
    latencyNote.textContent = `耗时 ${duration}s`;
    setStatus("done");
  } catch (err) {
    setStatus("error");
    setOutput(`请求失败：${err.message}`);
  }
}

async function runOnce(endpoint, payload) {
  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  setOutput(data.response || "未返回内容");
}

async function runStream(endpoint, payload) {
  const response = await fetch(`${endpoint}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  setOutput("");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.response) {
          output.textContent += json.response;
        }
        if (json.done) {
          refreshGroundingState();
          return;
        }
      } catch (err) {
        // Ignore malformed chunk
      }
    }
  }

  refreshGroundingState();
}

function copyOutput() {
  navigator.clipboard.writeText(output.textContent || "");
}

function downloadOutput() {
  const blob = new Blob([output.textContent || ""], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = currentFilename;
  a.click();
  URL.revokeObjectURL(url);
}

function clearOutput() {
  setOutput("等待识别输出…");
  latencyNote.textContent = "";
  setStatus("idle");
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  handleFile(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("active");
  });
});

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  handleFile(file);
});

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setPrompt(btn.dataset.prompt);
  });
});

runBtn.addEventListener("click", runOCR);
copyBtn.addEventListener("click", copyOutput);
downloadBtn.addEventListener("click", downloadOutput);
clearBtn.addEventListener("click", clearOutput);
locateBtn.addEventListener("click", openGroundingModal);
closeGrounding.addEventListener("click", closeGroundingModal);
groundingModal.addEventListener("click", (event) => {
  if (event.target?.dataset?.close) {
    closeGroundingModal();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && groundingModal.classList.contains("open")) {
    closeGroundingModal();
  }
});
groundingImage.addEventListener("load", updateGroundingBoxes);
window.addEventListener("resize", updateGroundingBoxes);

scrollToUpload.addEventListener("click", () => {
  document.getElementById("workspace").scrollIntoView({ behavior: "smooth" });
});

loadSample.addEventListener("click", async () => {
  const sampleUrl = "https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1200&q=80";
  try {
    setStatus("uploading");
    const response = await fetch(sampleUrl);
    const blob = await response.blob();
    const file = new File([blob], "sample.jpg", { type: blob.type });
    handleFile(file);
  } catch (err) {
    setStatus("error");
    alert("示例图片加载失败，请手动上传。 ");
  }
});

setPrompt("<|grounding|>Convert the document to markdown.");
setPreview(null);
setStatus("idle");
refreshGroundingState();
