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
const fullscreenBtn = document.getElementById("fullscreenBtn");

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
    /<\|ref\|>([\s\S]*?)<\|\/ref\|>\s*<\|det\|>\s*(\[\[[\s\S]*?\]\])\s*<\|\/det\|>/g;
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
      const boxes = parseDetBoxes(item.det);
      if (!boxes.length) {
        return null;
      }
      return {
        label: item.ref || "text",
        text: line || item.ref || "识别文本",
        boxes,
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

function updateGroundingBoxes() {
  if (!groundingImage.complete || !groundingItems.length) return;
  const scaleX = groundingImage.clientWidth / groundingImage.naturalWidth;
  const scaleY = groundingImage.clientHeight / groundingImage.naturalHeight;
  const boxElements = groundingBoxes.querySelectorAll(".grounding-box");

  boxElements.forEach((box) => {
    const itemIndex = Number.parseInt(box.dataset.item || "-1", 10);
    const boxIndex = Number.parseInt(box.dataset.box || "-1", 10);
    const item = groundingItems[itemIndex];
    const coords = item?.boxes?.[boxIndex];
    if (!coords) return;
    const boxCoords = normalizeBoxCoords(
      coords,
      groundingImage.naturalWidth,
      groundingImage.naturalHeight
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

function normalizeBoxCoords(coords, imageWidth, imageHeight) {
  const x1 = coords[0];
  const y1 = coords[1];
  const x2 = coords[2];
  const y2 = coords[3];
  const maxVal = Math.max(x1, y1, x2, y2);

  if (maxVal <= 1.5) {
    return {
      x1: x1 * imageWidth,
      y1: y1 * imageHeight,
      x2: x2 * imageWidth,
      y2: y2 * imageHeight,
    };
  }
  if (maxVal <= 100) {
    return {
      x1: (x1 / 100) * imageWidth,
      y1: (y1 / 100) * imageHeight,
      x2: (x2 / 100) * imageWidth,
      y2: (y2 / 100) * imageHeight,
    };
  }
  if (maxVal <= 1200) {
    return {
      x1: (x1 / 999) * imageWidth,
      y1: (y1 / 999) * imageHeight,
      x2: (x2 / 999) * imageWidth,
      y2: (y2 / 999) * imageHeight,
    };
  }
  return { x1, y1, x2, y2 };
}

function parseDetBoxes(detText) {
  if (!detText) return [];
  const raw = detText.trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    parsed = null;
  }

  let boxes = [];
  if (Array.isArray(parsed)) {
    if (Array.isArray(parsed[0])) {
      boxes = parsed;
    } else {
      for (let i = 0; i + 3 < parsed.length; i += 4) {
        boxes.push(parsed.slice(i, i + 4));
      }
    }
  } else {
    const coords = raw
      .replace(/[\[\]]/g, "")
      .split(/[,\s]+/)
      .filter((value) => value.length > 0)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value));
    for (let i = 0; i + 3 < coords.length; i += 4) {
      boxes.push(coords.slice(i, i + 4));
    }
  }

  return boxes
    .map((box) => box.map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value)))
    .filter((box) => box.length >= 4)
    .map((box) => box.slice(0, 4));
}

function setActiveGrounding(index) {
  activeGroundingIndex = index;
  groundingList.querySelectorAll(".grounding-item").forEach((item, idx) => {
    item.classList.toggle("active", idx === index);
  });
  groundingBoxes.querySelectorAll(".grounding-box").forEach((box) => {
    box.classList.toggle("active", Number.parseInt(box.dataset.item || "-1", 10) === index);
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

    item.boxes.forEach((_, boxIndex) => {
      const box = document.createElement("div");
      box.className = "grounding-box";
      box.dataset.item = String(index);
      box.dataset.box = String(boxIndex);
      groundingBoxes.appendChild(box);
    });
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
  updateFullscreenButton();
  if (groundingImage.complete) {
    updateGroundingBoxes();
  }
}

function closeGroundingModal() {
  groundingModal.classList.remove("open");
  groundingModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function updateFullscreenButton() {
  const isFullscreen = document.fullscreenElement === groundingModal.querySelector(".modal-card");
  fullscreenBtn.textContent = isFullscreen ? "退出全屏" : "全屏显示";
}

function toggleFullscreen() {
  const modalCard = groundingModal.querySelector(".modal-card");
  if (!modalCard) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  modalCard.requestFullscreen().catch(() => {
    alert("无法进入全屏模式");
  });
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
fullscreenBtn.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
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
