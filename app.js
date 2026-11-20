(() => {
  "use strict";

  const STORAGE_KEY = "nengajo-notebook-v1";
  const MAX_IMAGE_DATA_URL_LENGTH = 1_200_000;
  const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const status = $("#statusMessage");
  const contactDialog = $("#contactDialog");
  const designFonts = {
    gothic: '"Yu Gothic", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif',
    mincho: '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif',
    rounded: '"Hiragino Maru Gothic ProN", "Yu Gothic", Meiryo, sans-serif'
  };
  let state = loadState();

  function defaultState() {
    return {
      contacts: [],
      sender: { name: "", jointName: "", postalCode: "", address: "" },
      design: {
        dataUrl: "", text: "", x: 50, y: 82, scale: 1, rotation: 0,
        imageX: 0, imageY: 0, fontFamily: "gothic", fontSize: 16
      },
      excludeRetired: true,
      printSide: "address",
      orientation: "portrait"
    };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return defaultState();
      const parsed = JSON.parse(saved);
      const defaults = defaultState();
      const contacts = Array.isArray(parsed.contacts)
        ? parsed.contacts.filter(contact => contact && typeof contact === "object" && typeof contact.name === "string")
          .map((contact, index) => ({
            ...contact,
            id: typeof contact.id === "string" && contact.id ? contact.id : `contact-${index}`,
            name: contact.name,
            jointName: typeof contact.jointName === "string" ? contact.jointName : "",
            honorific: typeof contact.honorific === "string" ? contact.honorific : "様",
            postalCode: typeof contact.postalCode === "string" ? contact.postalCode : "",
            address: typeof contact.address === "string" ? contact.address : "",
            retired: contact.retired === true,
            retiredYear: typeof contact.retiredYear === "string" ? contact.retiredYear : "",
            retiredMemo: typeof contact.retiredMemo === "string" ? contact.retiredMemo : "",
            records: Array.isArray(contact.records)
              ? contact.records.filter(record => record && /^\d{4}$/.test(String(record.year)) && ["sent", "received", "mourning"].includes(record.direction))
                .map(record => ({ year: String(record.year), direction: record.direction }))
              : []
          }))
        : [];
      const savedDesign = { ...defaults.design, ...(parsed.design || {}) };
      const clamp = (value, min, max, fallback) => {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
      };
      return {
        ...defaults, ...parsed,
        contacts,
        sender: { ...defaults.sender, ...(parsed.sender || {}) },
        design: {
          ...savedDesign,
          dataUrl: typeof savedDesign.dataUrl === "string" && /^data:image\/(?:jpeg|png);base64,/.test(savedDesign.dataUrl)
            ? savedDesign.dataUrl : "",
          text: typeof savedDesign.text === "string" ? savedDesign.text : "",
          x: clamp(savedDesign.x, 3, 97, 50),
          y: clamp(savedDesign.y, 3, 97, 82),
          imageX: clamp(savedDesign.imageX, -200, 200, 0),
          imageY: clamp(savedDesign.imageY, -200, 200, 0),
          scale: clamp(savedDesign.scale, 0.5, 2, 1),
          rotation: ((clamp(savedDesign.rotation, 0, 360, 0) % 360) + 360) % 360,
          fontFamily: Object.prototype.hasOwnProperty.call(designFonts, savedDesign.fontFamily) ? savedDesign.fontFamily : "gothic",
          fontSize: clamp(savedDesign.fontSize, 8, 36, 16)
        },
        orientation: parsed.orientation === "landscape" ? "landscape" : "portrait",
        printSide: parsed.printSide === "back" ? "back" : "address",
        excludeRetired: parsed.excludeRetired !== false
      };
    } catch (error) {
      console.error("保存データを読み込めませんでした。", error);
      setStatus("保存データを読み込めません。ブラウザーの保存領域を確認してください。", true);
      return defaultState();
    }
  }

  function persist(nextState = state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      state = nextState;
      setStatus("保存しました。");
      return true;
    } catch (error) {
      console.error("データを保存できませんでした。", error);
      const message = error && (error.name === "QuotaExceededError" || error.code === 22)
        ? "保存容量が不足しています。画像を小さくするか、不要なデータを削除してください。"
        : "保存できませんでした。ブラウザーの設定を確認してください。";
      setStatus(message, true);
      return false;
    }
  }

  function setStatus(message, isError = false) {
    status.textContent = message;
    status.classList.toggle("error-message", isError);
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function visibleContacts() {
    return state.contacts.filter(contact => !(state.excludeRetired && contact.retired));
  }

  function renderContacts() {
    const rows = $("#contactRows");
    const contacts = [...state.contacts].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    $("#contactCount").textContent = `${contacts.length} 件`;
    if (!contacts.length) {
      rows.innerHTML = '<tr><td class="empty-state" colspan="6">住所録はまだありません。「宛先を追加」またはCSVを読み込んでください。</td></tr>';
      refreshPrintControls();
      return;
    }
    rows.innerHTML = contacts.map(contact => {
      const history = (contact.records || []).map(record => `${escapeHtml(record.year)}年${record.direction === "sent" ? "出" : record.direction === "mourning" ? "喪" : "受"}`).join(" / ");
      const retired = contact.retired
        ? `<span class="retired-badge">じまい${contact.retiredYear ? `（${escapeHtml(contact.retiredYear)}年）` : ""}</span><div>${escapeHtml(contact.retiredMemo || "")}</div>`
        : "—";
      const checked = contact.printSelected !== false && !(state.excludeRetired && contact.retired) ? "checked" : "";
      const disabled = state.excludeRetired && contact.retired ? "disabled" : "";
      return `<tr>
        <td><input class="print-check" type="checkbox" data-id="${escapeHtml(contact.id)}" ${checked} ${disabled} aria-label="${escapeHtml(contact.name)}を印刷"></td>
        <td><span class="contact-name">${escapeHtml(contact.name)}${contact.jointName ? `・${escapeHtml(contact.jointName)}` : ""} ${escapeHtml(contact.honorific || "様")}</span></td>
        <td>${escapeHtml(contact.postalCode || "")}<br>${escapeHtml(contact.address || "")}</td>
        <td>${retired}</td><td>${history || "—"}</td>
        <td><div class="row-actions"><button class="small-button edit-contact" data-id="${escapeHtml(contact.id)}" type="button">編集</button></div></td>
      </tr>`;
    }).join("");
    refreshPrintControls();
  }

  function refreshPrintControls() {
    updatePrintPreview();
  }

  function openContact(contact) {
    const form = $("#contactForm");
    form.reset();
    $("#contactDialogTitle").textContent = contact ? "宛先を編集" : "宛先を追加";
    $("#deleteContactButton").hidden = !contact;
    const values = contact || { id: "", name: "", jointName: "", honorific: "様", postalCode: "", address: "", retired: false, retiredYear: "", retiredMemo: "" };
    for (const key of ["id", "name", "jointName", "honorific", "postalCode", "address", "retiredYear", "retiredMemo"]) {
      form.elements[key].value = values[key] || "";
    }
    form.elements.retired.checked = Boolean(values.retired);
    form.elements.recordYear.value = "";
    form.elements.recordDirection.value = "";
    contactDialog.showModal();
  }

  function saveContact(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const id = values.id || crypto.randomUUID();
    const existing = state.contacts.find(contact => contact.id === id);
    const contact = {
      id,
      name: values.name.trim(),
      jointName: values.jointName.trim(),
      honorific: values.honorific.trim() || "様",
      postalCode: values.postalCode.trim(),
      address: values.address.trim(),
      retired: form.elements.retired.checked,
      retiredYear: values.retiredYear.trim(),
      retiredMemo: values.retiredMemo.trim(),
      records: Array.isArray(existing?.records) ? [...existing.records] : []
    };
    const year = values.recordYear.trim();
    const direction = values.recordDirection;
    if ((year && !/^\d{4}$/.test(year)) || (year && !direction) || (!year && direction)) {
      setStatus("年次記録を追加する場合は、4桁の年と「出した／受け取った」を両方指定してください。", true);
      return;
    }
    if (/^\d{4}$/.test(year) && direction) {
      const prior = contact.records.findIndex(record => record.year === year && record.direction === direction);
      const record = { year, direction };
      if (prior >= 0) contact.records[prior] = record;
      else contact.records.push(record);
      contact.records.sort((a, b) => Number(a.year) - Number(b.year) || a.direction.localeCompare(b.direction));
    }
    const contacts = existing
      ? state.contacts.map(item => item.id === id ? contact : item)
      : [...state.contacts, contact];
    if (persist({ ...state, contacts })) {
      contactDialog.close();
      renderContacts();
    }
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportCsv() {
    const header = ["氏名", "連名", "敬称", "郵便番号", "住所", "年賀状じまい", "送信終了年", "じまいメモ", "年次記録"];
    const lines = [header, ...state.contacts.map(contact => [
      contact.name, contact.jointName, contact.honorific, contact.postalCode, contact.address,
      contact.retired ? "はい" : "いいえ", contact.retiredYear, contact.retiredMemo,
      (contact.records || []).map(record => `${record.year}:${record.direction}`).join(";")
    ])].map(row => row.map(csvEscape).join(","));
    downloadBlob(new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), "nengajo-address-book.csv");
    setStatus("住所録CSVを書き出しました。");
  }

  function countDelimitersInHeader(line, delimiter) {
    let count = 0, quoted = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' && line[i + 1] === '"' && quoted) i++;
      else if (line[i] === '"') quoted = !quoted;
      else if (!quoted && line[i] === delimiter) count++;
    }
    return count;
  }

  function parseCsv(text) {
    const source = text.replace(/^\uFEFF/, "");
    const firstLine = source.split(/\r?\n/, 1)[0] || "";
    const delimiter = [",", "\t", ";"].sort((a, b) =>
      countDelimitersInHeader(firstLine, b) - countDelimitersInHeader(firstLine, a)
    )[0];
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field.length === 0) quoted = true;
      else if (char === delimiter) { row.push(field); field = ""; }
      else if (char === "\n" || char === "\r") {
        if (char === "\r" && source[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
      } else field += char;
    }
    if (quoted) throw new Error("CSVの引用符が閉じられていません。ファイル形式を確認してください。");
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
    if (!rows.length) throw new Error("CSVにデータがありません。");
    const width = rows[0].length;
    const inconsistent = rows.slice(1).filter(values => values.length !== width).length;
    return { rows, inconsistent };
  }

  const headerAliases = {
    name: ["氏名", "名前", "宛名", "name", "お名前", "宛名氏名"],
    surname: ["姓", "苗字", "名字", "surname", "lastname"],
    givenName: ["名", "first name", "firstname"],
    jointName: ["連名", "連名1", "連名氏名", "同居人", "jointname"],
    honorific: ["敬称", "様", "敬称1", "honorific"],
    postalCode: ["郵便番号", "郵便", "〒", "郵便番号1", "postalcode", "zip"],
    address: ["住所", "住所1", "住所２", "住所2", "番地", "address", "所在地"],
    address2: ["住所3", "住所_2", "住所2", "建物名", "address2"],
    retired: ["年賀状じまい", "辞退", "送付停止", "retired"],
    retiredYear: ["送信終了年", "辞退年", "終了年", "retiredyear"],
    retiredMemo: ["じまいメモ", "辞退メモ", "メモ", "retiredmemo"],
    records: ["年次記録", "送受記録", "年賀状記録", "records"]
  };
  function normalizeHeader(value) {
    return value.trim().toLowerCase().replace(/[\s　_\-]/g, "");
  }

  async function importCsv(file) {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength >= 8 && new TextDecoder("ascii").decode(buffer.slice(0, 8)) === "MRNDBFMT") {
      throw new Error("筆まめの住所録ファイル（.fwa）は直接読み込めません。筆まめでCSV形式に書き出してから読み込んでください。");
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      try { text = new TextDecoder("shift_jis", { fatal: true }).decode(buffer); }
      catch { throw new Error("文字コードを判別できません。UTF-8またはShift_JISのCSVで保存してください。"); }
    }
    const { rows, inconsistent } = parseCsv(text);
    const headers = rows[0].map(normalizeHeader);
    const mapping = {};
    for (const [field, aliases] of Object.entries(headerAliases)) {
      const match = aliases.map(normalizeHeader).map(alias => headers.indexOf(alias)).find(index => index >= 0);
      if (match !== undefined) mapping[field] = match;
    }
    if (mapping.name === undefined && mapping.surname === undefined) {
      throw new Error("氏名の列を見つけられません。CSVの1行目に「氏名」または「姓」などの見出しが必要です。");
    }
    const retiredTrueValues = ["はい", "済", "辞退", "true", "1", "yes", "○", "〇"];
    const imported = [];
    let skippedWithoutName = 0;
    for (const cells of rows.slice(1)) {
      const get = field => mapping[field] === undefined ? "" : (cells[mapping[field]] || "").trim();
      const name = get("name") || [get("surname"), get("givenName")].filter(Boolean).join(" ");
      if (!name) { skippedWithoutName++; continue; }
      const retiredText = get("retired").toLowerCase();
      const addressParts = [get("address"), get("address2")].filter((part, index, parts) =>
        part && parts.indexOf(part) === index
      );
      const records = get("records").split(/[;；、]/).map(entry => {
        const match = entry.trim().match(/^(\d{4})\s*[:：,]\s*(sent|received|mourning|出|受|出した|受け取った|喪中はがき|喪中|喪)$/i);
        if (!match) return null;
        const direction = /^(mourning|喪中はがき|喪中|喪)$/i.test(match[2]) ? "mourning" : /^(sent|出|出した)$/i.test(match[2]) ? "sent" : "received";
        return { year: match[1], direction };
      }).filter(Boolean);
      imported.push({
        id: crypto.randomUUID(), name, jointName: get("jointName"),
        honorific: get("honorific") || "様", postalCode: get("postalCode"), address: addressParts.join(" "),
        retired: retiredTrueValues.includes(retiredText),
        retiredSpecified: Boolean(get("retired")),
        retiredYear: get("retiredYear"), retiredMemo: get("retiredMemo"), records
      });
    }
    if (!imported.length) throw new Error("氏名が入力された行がありません。");
    let added = 0, updated = 0;
    const contacts = [...state.contacts];
    for (const incoming of imported) {
      const index = contacts.findIndex(contact => contact.name === incoming.name && contact.postalCode === incoming.postalCode);
      if (index >= 0) {
        const existing = contacts[index];
        const merged = { ...existing, id: existing.id, records: existing.records || [] };
        for (const field of ["name", "jointName", "honorific", "postalCode", "address", "retiredYear", "retiredMemo"]) {
          if (incoming[field]) merged[field] = incoming[field];
        }
        if (incoming.retiredSpecified) merged.retired = incoming.retired;
        const records = Array.isArray(merged.records) ? [...merged.records] : [];
        for (const record of incoming.records) {
          if (!records.some(item => item.year === record.year && item.direction === record.direction)) records.push(record);
        }
        merged.records = records.sort((a, b) => Number(a.year) - Number(b.year) || a.direction.localeCompare(b.direction));
        contacts[index] = merged;
        updated++;
      } else {
        const { retiredSpecified, ...contact } = incoming;
        contacts.push(contact);
        added++;
      }
    }
    if (!persist({ ...state, contacts })) return;
    renderContacts();
    const warnings = [];
    if (inconsistent) warnings.push(`列数不一致 ${inconsistent} 行`);
    if (skippedWithoutName) warnings.push(`氏名欠損 ${skippedWithoutName} 行を除外`);
    setStatus(`CSVを取り込みました（新規 ${added} 件・更新 ${updated} 件${warnings.length ? `。確認: ${warnings.join("、")}` : ""}）。`, warnings.length > 0);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importImage(file) {
    if (!file || !/^image\/(png|jpeg)$/.test(file.type)) throw new Error("PNGまたはJPG画像を選択してください。");
    if (file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error("元画像が大きすぎます。20 MB以下の画像を選んでください。");
    const bitmap = await createImageBitmap(file);
    const maxSide = 1800;
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) { bitmap.close(); throw new Error("画像を加工できません。別のブラウザーをお試しください。"); }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) throw new Error("圧縮後の画像が保存上限を超えています。小さい画像を選んでください。");
    if (persist({ ...state, design: { ...state.design, dataUrl } })) {
      renderDesign();
    }
  }

  function renderDesign(updatePrint = true, updateControls = true) {
    const image = $("#designImage");
    const orientationClass = state.orientation === "landscape" ? "is-landscape" : "is-portrait";
    $("#backPreview").classList.remove("is-landscape", "is-portrait");
    $("#backPreview").classList.add(orientationClass);
    image.src = state.design.dataUrl || "";
    image.style.transform = `translate(${state.design.imageX || 0}%, ${state.design.imageY || 0}%) rotate(${state.design.rotation}deg) scale(${state.design.scale})`;
    if (updateControls) {
      $("#imageScale").value = String(state.design.scale);
      $("#designText").value = state.design.text;
      $("#textX").value = String(state.design.x);
      $("#textY").value = String(state.design.y);
      $("#fontFamily").value = state.design.fontFamily || "gothic";
      $("#fontSize").value = String(state.design.fontSize || 16);
      $("#fontSizeValue").textContent = `${state.design.fontSize || 16} pt`;
      $("#orientationDesign").value = state.orientation;
      $("#orientationPrint").value = state.orientation;
    }
    const dimensions = state.orientation === "landscape" ? "148 × 100 mm" : "100 × 148 mm";
    $("#designSizeHint").textContent = `プレビューははがき比率（${dimensions}）です。印刷時は用紙サイズを「はがき」に設定してください。`;
    const message = $("#designMessage");
    message.textContent = state.design.text;
    message.style.left = `${state.design.x}%`;
    message.style.top = `${state.design.y}%`;
    applyDesignTextStyles(message);
    if (updatePrint) updatePrintPreview();
  }

  function applyDesignTextStyles(element) {
    element.style.fontFamily = designFonts[state.design.fontFamily] || designFonts.gothic;
    element.style.fontSize = `${Math.max(8, Math.min(36, Number(state.design.fontSize) || 16))}pt`;
  }

  function renderSender() {
    const form = $("#senderForm");
    for (const key of ["name", "jointName", "postalCode", "address"]) form.elements[key].value = state.sender[key] || "";
  }

  function updatePrintPreview() {
    const preview = $("#printPreview");
    const side = $("#printSide").value;
    state.printSide = side;
    const orientationClass = state.orientation === "landscape" ? "is-landscape" : "is-portrait";
    preview.dataset.orientation = state.orientation;
    const isBack = side === "back";
    const dimensions = state.orientation === "landscape" ? "148 × 100 mm" : "100 × 148 mm";
    $("#printHelp").textContent = isBack
      ? `裏面デザインを${dimensions}で印刷します。`
      : `チェック済みの宛先を1件ずつ${dimensions}で印刷します。印刷ダイアログで用紙を「はがき」に設定してください。`;
    if (isBack) {
      preview.innerHTML = `<div class="postcard ${orientationClass} back-preview"><img alt="" src="${state.design.dataUrl}"><div class="design-message" style="left:${state.design.x}%;top:${state.design.y}%">${escapeHtml(state.design.text)}</div></div>`;
      const img = $("img", preview);
      img.style.transform = `translate(${state.design.imageX || 0}%, ${state.design.imageY || 0}%) rotate(${state.design.rotation}deg) scale(${state.design.scale})`;
      applyDesignTextStyles($(".design-message", preview));
      return;
    }
    const checkedIds = new Set($$(".print-check:checked").map(input => input.dataset.id));
    const contacts = state.contacts.filter(item => checkedIds.has(item.id) && !(state.excludeRetired && item.retired));
    if (!contacts.length) {
      preview.innerHTML = '<div class="empty-state">印刷対象がありません。住所録の「印刷」欄で宛先を選択してください。</div>';
      return;
    }
    const cards = contacts.map(contact => {
      const card = document.createElement("div");
      card.className = `postcard ${orientationClass}`;
      const template = $("#addressPrintTemplate").content.cloneNode(true);
      renderPostalCode($(".address-postal", template), contact.postalCode);
      $(".address-recipient", template).textContent = `${contact.address || ""}\n${contact.name}${contact.jointName ? `\n${contact.jointName}` : ""} ${contact.honorific || "様"}`;
      $(".address-sender", template).textContent = `${state.sender.postalCode ? `〒${formatPostal(state.sender.postalCode)}\n` : ""}${state.sender.address || ""}\n${state.sender.name}${state.sender.jointName ? `・${state.sender.jointName}` : ""}`;
      card.append(template);
      return card;
    });
    preview.replaceChildren(...cards);
  }

  function formatPostal(value = "") {
    const digits = String(value).replace(/[^\d]/g, "");
    return digits.length === 7 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : value;
  }

  function renderPostalCode(container, value) {
    const digits = String(value || "").replace(/[^\d]/g, "");
    if (digits.length !== 7) {
      container.textContent = value || "";
      return;
    }
    container.replaceChildren(...digits.split("").map(digit => {
      const box = document.createElement("span");
      box.textContent = digit;
      return box;
    }));
  }

  $("#fontFamily").addEventListener("change", event => {
    if (persist({ ...state, design: { ...state.design, fontFamily: event.target.value } })) renderDesign();
    else renderDesign();
  });
  $("#fontSize").addEventListener("input", event => {
    state = { ...state, design: { ...state.design, fontSize: Number(event.target.value) } };
    $("#fontSizeValue").textContent = `${event.target.value} pt`;
    renderDesign(true, false);
  });
  $("#fontSize").addEventListener("change", () => {
    if (persist({ ...state, design: { ...state.design } })) renderDesign();
    else renderDesign();
  });
  $("#resetCropButton").addEventListener("click", () => {
    if (persist({ ...state, design: { ...state.design, imageX: 0, imageY: 0, scale: 1 } })) renderDesign();
  });
  function changeOrientation(value) {
    if (persist({ ...state, orientation: value })) renderDesign();
    else {
      $("#orientationDesign").value = state.orientation;
      $("#orientationPrint").value = state.orientation;
    }
  }
  $("#orientationDesign").addEventListener("change", event => changeOrientation(event.target.value));
  $("#orientationPrint").addEventListener("change", event => changeOrientation(event.target.value));

  const preview = $("#backPreview");
  const activePointers = new Map();
  let gesture = null;

  function pointerCenter(points) {
    return {
      x: (points[0].x + points[1].x) / 2,
      y: (points[0].y + points[1].y) / 2
    };
  }

  function beginGesture(target) {
    const points = [...activePointers.values()];
    const bounds = preview.getBoundingClientRect();
    if (points.length > 1) {
      const center = pointerCenter(points);
      gesture = {
        mode: "image", pinch: true, center,
        distance: Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)),
        scale: state.design.scale, imageX: state.design.imageX || 0, imageY: state.design.imageY || 0,
        width: bounds.width, height: bounds.height
      };
      return;
    }
    if (!points.length) { gesture = null; return; }
    const point = points[0];
    gesture = {
      mode: target.closest("#designMessage") ? "text" : "image",
      pinch: false, x: point.x, y: point.y,
      imageX: state.design.imageX || 0, imageY: state.design.imageY || 0,
      textX: state.design.x, textY: state.design.y,
      scale: state.design.scale, width: bounds.width, height: bounds.height
    };
  }

  function updateGesture() {
    if (!gesture || !activePointers.size) return;
    const points = [...activePointers.values()];
    let design = { ...state.design };
    if (gesture.pinch && points.length > 1) {
      const center = pointerCenter(points);
      const distance = Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
      design.scale = Math.min(2, Math.max(0.5, gesture.scale * distance / gesture.distance));
      design.imageX = gesture.imageX + (center.x - gesture.center.x) / gesture.width * 100;
      design.imageY = gesture.imageY + (center.y - gesture.center.y) / gesture.height * 100;
    } else {
      const point = points[0];
      const deltaX = (point.x - gesture.x) / gesture.width * 100;
      const deltaY = (point.y - gesture.y) / gesture.height * 100;
      if (gesture.mode === "text") {
        design.x = Math.min(97, Math.max(3, gesture.textX + deltaX));
        design.y = Math.min(97, Math.max(3, gesture.textY + deltaY));
      } else {
        design.imageX = gesture.imageX + deltaX;
        design.imageY = gesture.imageY + deltaY;
      }
    }
    state = { ...state, design };
    renderDesign(false);
  }

  preview.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    event.preventDefault();
    preview.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture(event.target);
  });
  preview.addEventListener("pointermove", event => {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    updateGesture();
  });
  function endPointerGesture(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size) beginGesture(event.target);
    else {
      gesture = null;
      if (persist({ ...state, design: { ...state.design } })) updatePrintPreview();
    }
  }
  preview.addEventListener("pointerup", endPointerGesture);
  preview.addEventListener("pointercancel", endPointerGesture);

  $$(".tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".tab").forEach(item => item.classList.toggle("is-active", item === tab));
    $$(".tab-panel").forEach(panel => { panel.hidden = panel.id !== tab.dataset.panel; });
    if (tab.dataset.panel === "printPanel") updatePrintPreview();
  }));
  $("#addContactButton").addEventListener("click", () => openContact(null));
  $("#contactForm").addEventListener("submit", saveContact);
  $("#closeDialogButton").addEventListener("click", () => contactDialog.close());
  $("#cancelDialogButton").addEventListener("click", () => contactDialog.close());
  $("#contactRows").addEventListener("click", event => {
    const button = event.target.closest(".edit-contact");
    if (button) openContact(state.contacts.find(contact => contact.id === button.dataset.id));
  });
  $("#deleteContactButton").addEventListener("click", () => {
    const id = $("#contactForm").elements.id.value;
    if (!id || !confirm("この宛先を削除しますか？")) return;
    if (persist({ ...state, contacts: state.contacts.filter(contact => contact.id !== id) })) {
      contactDialog.close(); renderContacts();
    }
  });
  $("#excludeRetired").checked = state.excludeRetired;
  $("#excludeRetired").addEventListener("change", event => {
    if (persist({ ...state, excludeRetired: event.target.checked })) renderContacts();
  });
  $("#contactRows").addEventListener("change", event => {
    if (!event.target.matches(".print-check")) return;
    const id = event.target.dataset.id;
    const contacts = state.contacts.map(contact => contact.id === id
      ? { ...contact, printSelected: event.target.checked }
      : contact);
    if (persist({ ...state, contacts })) renderContacts();
  });
  $("#senderForm").addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (persist({ ...state, sender: data })) updatePrintPreview();
  });
  $("#csvInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    if (!file) return;
    try { await importCsv(file); } catch (error) { setStatus(error.message || "CSVを読み込めませんでした。", true); }
    event.target.value = "";
  });
  $("#exportButton").addEventListener("click", exportCsv);
  $("#imageInput").addEventListener("change", async event => {
    const file = event.target.files[0];
    try { if (file) await importImage(file); } catch (error) { setStatus(error.message || "画像を読み込めませんでした。", true); }
    event.target.value = "";
  });
  $("#rotateImageButton").addEventListener("click", () => {
    if (persist({ ...state, design: { ...state.design, rotation: (state.design.rotation + 90) % 360 } })) renderDesign();
  });
  $("#imageScale").addEventListener("input", event => {
    state = { ...state, design: { ...state.design, scale: Number(event.target.value) } };
    renderDesign(true, false);
  });
  $("#imageScale").addEventListener("change", () => {
    if (!persist({ ...state, design: { ...state.design } })) renderDesign();
  });
  $("#designText").addEventListener("input", event => {
    state = { ...state, design: { ...state.design, text: event.target.value } };
    renderDesign(true, false);
  });
  $("#textX").addEventListener("input", event => {
    state = { ...state, design: { ...state.design, x: Number(event.target.value) } };
    renderDesign(true, false);
  });
  $("#textY").addEventListener("input", event => {
    state = { ...state, design: { ...state.design, y: Number(event.target.value) } };
    renderDesign(true, false);
  });
  ["designText", "textX", "textY"].forEach(id => $(`#${id}`).addEventListener("change", () => {
    if (!persist({ ...state, design: { ...state.design } })) renderDesign();
  }));
  $("#printSide").value = state.printSide;
  $("#printSide").addEventListener("change", event => {
    if (persist({ ...state, printSide: event.target.value })) updatePrintPreview();
    else event.target.value = state.printSide;
  });
  $("#printButton").addEventListener("click", () => {
    $$(".tab").forEach(item => item.classList.toggle("is-active", item.dataset.panel === "printPanel"));
    $$(".tab-panel").forEach(panel => { panel.hidden = panel.id !== "printPanel"; });
    window.print();
  });

  renderSender();
  renderDesign();
  renderContacts();
})();
