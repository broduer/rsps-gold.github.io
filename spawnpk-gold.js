(function () {
  "use strict";
  var controls = document.querySelector("[data-spawnpk-request-controls]");
  var amount = document.getElementById("spawnpk-amount");
  var preview = document.getElementById("spawnpk-order-message");
  var error = document.getElementById("spawnpk-amount-error");
  if (!controls || !amount || !preview || !error) return;
  var copyButtons = document.querySelectorAll('[data-copy-target="spawnpk-order-message"]');
  var presets = document.querySelectorAll("[data-spawnpk-amount]");
  var previewToggle = document.getElementById("spawnpk-preview-toggle");
  var previewPanel = document.getElementById("spawnpk-message-panel");
  var template = preview.textContent;
  var finalPreview = document.getElementById("spawnpk-final-message");
  var lastAcceptedValue = amount.value;
  function isEditableAmount(value) {
    return /^[0-9]{0,4}$/.test(value) && (value === "" || Number(value) <= 1000);
  }
  function replacementValue(text) {
    var start = amount.selectionStart == null ? amount.value.length : amount.selectionStart;
    var end = amount.selectionEnd == null ? start : amount.selectionEnd;
    return amount.value.slice(0, start) + text + amount.value.slice(end);
  }
  // Reject the whole edit: stripping punctuation could turn 2.5 into 25.
  amount.addEventListener("beforeinput", function (event) {
    if (event.data != null && !isEditableAmount(replacementValue(event.data))) event.preventDefault();
  });
  amount.addEventListener("paste", function (event) {
    if (event.clipboardData && !isEditableAmount(replacementValue(event.clipboardData.getData("text")))) event.preventDefault();
  });
  // Read authored/rendered copy from HTML; never embed identity, rates or URLs.
  function updateRequest() {
    // Also covers autofill, drops and browsers without cancellable beforeinput.
    if (!isEditableAmount(amount.value)) amount.value = lastAcceptedValue;
    lastAcceptedValue = amount.value;
    var value = amount.value === "" ? "" : String(Number(amount.value));
    var valid = /^[0-9]+$/.test(value) && Number(value) > 0 && Number(value) <= 1000;
    error.hidden = valid;
    amount.setAttribute("aria-invalid", valid ? "false" : "true");
    copyButtons.forEach(function (button) { button.disabled = !valid; });
    presets.forEach(function (button) {
      button.setAttribute("aria-pressed", valid && Number(button.getAttribute("data-spawnpk-amount")) === Number(value) ? "true" : "false");
    });
    preview.textContent = valid
      ? template.replace("Amount needed: 10T", "Amount needed: " + value + "T")
      : "Choose a whole-number amount from 1 to 1,000T to prepare your request.";
    if (finalPreview) finalPreview.textContent = preview.textContent;
  }
  controls.hidden = false;
  amount.addEventListener("input", updateRequest);
  presets.forEach(function (button) {
    button.addEventListener("click", function () {
      amount.value = button.getAttribute("data-spawnpk-amount");
      updateRequest();
    });
  });
  if (previewToggle && previewPanel) {
    // Without JavaScript the message stays visible and can be copied manually.
    previewToggle.hidden = false;
    previewPanel.hidden = true;
    previewToggle.setAttribute("aria-expanded", "false");
    previewToggle.addEventListener("click", function () {
      previewPanel.hidden = !previewPanel.hidden;
      previewToggle.setAttribute("aria-expanded", previewPanel.hidden ? "false" : "true");
    });
  }
  updateRequest();
})();

(function () {
  "use strict";
  var root = document.getElementById("spk-preview");
  if (!root) return;
  // Expand FAQ answers for both in-page links and direct incoming fragment URLs.
  function revealHash(hash) {
    if (!hash || hash.charAt(0) !== "#") return;
    var id;
    try { id = decodeURIComponent(hash.slice(1)); } catch (_) { return; }
    var target = document.getElementById(id);
    if (!target || !root.contains(target)) return;
    var details = target.closest("details");
    if (details) details.open = true;
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener("click", function () { revealHash(link.getAttribute("href")); }, true);
  });
  revealHash(window.location.hash);
  window.addEventListener("hashchange", function () { revealHash(window.location.hash); });
})();
