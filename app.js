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
const latencyNote = document.getElementById("latencyNote");
const scrollToUpload = document.getElementById("scrollToUpload");
const loadSample = document.getElementById("loadSample");

let currentImage = null;
let currentFilename = "ocr-result.md";

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
          return;
        }
      } catch (err) {
        // Ignore malformed chunk
      }
    }
  }
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
