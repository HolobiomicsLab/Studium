// Studium documentation: the menu button at narrow widths, copy buttons on code blocks and the search
// box. The pages read fine without it: everything here is drawn by the script, so nothing shows broken
// when scripts are off. Written to site.js by tools/docs/build-site.mjs; no network, no library.
(function (global) {
  "use strict";

  var STRINGS = {
    en: {
      search: "Search", searchLabel: "Search the documentation", placeholder: "Search", hint: "Press / to search",
      none: "No result", one: "1 result", many: " results", copy: "Copy", copied: "Copied",
      copyLabel: "Copy the code", copiedNote: "Code copied to the clipboard",
    },
    fr: {
      search: "Rechercher", searchLabel: "Rechercher dans la documentation", placeholder: "Rechercher", hint: "Appuyez sur / pour rechercher",
      none: "Aucun résultat", one: "1 résultat", many: " résultats", copy: "Copier", copied: "Copié",
      copyLabel: "Copier le code", copiedNote: "Code copié dans le presse-papiers",
    },
  };
  var MAX_RESULTS = 12;
  var EXCERPT_RADIUS = 60;

  function stringsFor(lang) {
    return STRINGS[lang] || STRINGS.en;
  }

  // NFC Latin text keeps its length through this fold, so an offset found in the folded text is an
  // offset in the original: the excerpt can show the accents the reader typed without.
  function fold(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function wordsOf(query) {
    return fold(query).split(/\s+/).filter(Boolean);
  }

  function containsAll(haystack, words) {
    for (var i = 0; i < words.length; i += 1) if (haystack.indexOf(words[i]) < 0) return false;
    return true;
  }

  function excerptAround(text, at, length) {
    var start = Math.max(0, at - EXCERPT_RADIUS);
    var end = Math.min(text.length, at + length + EXCERPT_RADIUS);
    return (start > 0 ? "… " : "") + text.slice(start, end).trim() + (end < text.length ? " …" : "");
  }

  function headingMatch(page, words) {
    for (var i = 0; i < page.headings.length; i += 1) {
      var heading = page.headings[i];
      if (containsAll(fold(heading.text), words)) return heading;
    }
    return null;
  }

  // Folding a page's whole text on every keystroke would be the slow part of a search; once is enough.
  function foldedTextOf(page) {
    if (!page.folded) {
      page.folded = { text: fold(page.text), headings: fold(page.headings.map(function (h) { return h.text; }).join(" ")) };
    }
    return page.folded;
  }

  /** Rank: every word in the title, then in one heading, then anywhere in the page. */
  function search(index, query) {
    var words = wordsOf(query);
    if (!words.length) return [];
    var byTitle = [], byHeading = [], byText = [];
    index.forEach(function (page) {
      if (containsAll(fold(page.title), words)) {
        byTitle.push({ url: page.url, label: page.title, kind: "title", excerpt: "" });
        return;
      }
      var heading = headingMatch(page, words);
      if (heading) {
        byHeading.push({ url: page.url + "#" + heading.id, label: page.title + " › " + heading.text, kind: "heading", excerpt: "" });
        return;
      }
      var folded = foldedTextOf(page);
      if (!containsAll(fold(page.title) + " " + folded.headings + " " + folded.text, words)) return;
      var at = folded.text.indexOf(words[0]);
      byText.push({ url: page.url, label: page.title, kind: "text", excerpt: at >= 0 ? excerptAround(page.text, at, words[0].length) : "" });
    });
    return byTitle.concat(byHeading, byText).slice(0, MAX_RESULTS);
  }

  global.StudiumDocs = { fold: fold, search: search, stringsFor: stringsFor };
  if (typeof document === "undefined") return;

  // -------------------------------------------------------------------------------------------
  // Page behaviour

  var lang = document.documentElement.lang;
  var text = stringsFor(lang);
  var announcer;

  function announce(message) {
    announcer.textContent = "";
    // A fresh text node after clearing makes screen readers repeat an identical message.
    setTimeout(function () { announcer.textContent = message; }, 50);
  }

  function setUpMenu() {
    var button = document.querySelector(".nav-button");
    if (!button) return;
    button.hidden = false;
    button.addEventListener("click", function () {
      var open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      document.body.classList.toggle("nav-open", open);
    });
  }

  function copyWithSelection(value) {
    var area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.className = "visually-hidden";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); } catch (error) { /* nothing more to try */ }
    document.body.removeChild(area);
  }

  // navigator.clipboard is missing or refuses on file:// in some browsers; the old selection copy
  // still works there, and a failure of both stays silent rather than alarming the reader.
  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).catch(function () { copyWithSelection(value); });
    }
    copyWithSelection(value);
    return Promise.resolve();
  }

  function addCopyButton(pre) {
    var wrapper = document.createElement("div");
    wrapper.className = "code-block";
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.textContent = text.copy;
    button.setAttribute("aria-label", text.copyLabel);
    var timer = null;
    button.addEventListener("click", function () {
      var code = pre.querySelector("code") || pre;
      copyText(code.textContent.replace(/\n$/, "")).then(function () {
        button.textContent = text.copied;
        announce(text.copiedNote);
        clearTimeout(timer);
        timer = setTimeout(function () { button.textContent = text.copy; }, 2000);
      });
    });
    wrapper.appendChild(button);
  }

  function setUpCopyButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".prose pre"), addCopyButton);
  }

  // The index is a script that assigns a global, because fetch() of a local JSON file fails under
  // file://; it is loaded on first use so that pages that never search do not pay for it.
  function loadIndex(src, done) {
    var indexes = global.STUDIUM_SEARCH_INDEX;
    if (indexes && indexes[lang]) { done(indexes[lang]); return; }
    var script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", function () {
      var loaded = global.STUDIUM_SEARCH_INDEX;
      done(loaded && loaded[lang] ? loaded[lang] : []);
    });
    script.addEventListener("error", function () { done([]); });
    document.head.appendChild(script);
  }

  function isTypingTarget(element) {
    if (!element) return false;
    var tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
  }

  function buildSearchBox() {
    var form = document.createElement("form");
    form.className = "site-search";
    form.setAttribute("role", "search");
    var label = document.createElement("label");
    label.className = "visually-hidden";
    label.htmlFor = "st-search";
    label.textContent = text.searchLabel;
    var input = document.createElement("input");
    input.type = "search";
    input.id = "st-search";
    input.placeholder = text.placeholder;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-describedby", "st-search-hint");
    input.setAttribute("aria-controls", "st-search-results");
    var hint = document.createElement("span");
    hint.id = "st-search-hint";
    hint.className = "visually-hidden";
    hint.textContent = text.hint;
    var status = document.createElement("p");
    status.className = "visually-hidden";
    status.setAttribute("aria-live", "polite");
    var list = document.createElement("ul");
    list.id = "st-search-results";
    list.className = "search-results";
    list.hidden = true;
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(hint);
    form.appendChild(status);
    form.appendChild(list);
    return { form: form, input: input, status: status, list: list };
  }

  function resultItem(result, root) {
    var item = document.createElement("li");
    var link = document.createElement("a");
    link.href = root + result.url;
    var title = document.createElement("span");
    title.className = "search-title";
    title.textContent = result.label;
    link.appendChild(title);
    if (result.excerpt) {
      var excerpt = document.createElement("span");
      excerpt.className = "search-excerpt";
      excerpt.textContent = result.excerpt;
      link.appendChild(excerpt);
    }
    item.appendChild(link);
    return item;
  }

  function countText(n) {
    return n === 0 ? text.none : n === 1 ? text.one : n + text.many;
  }

  function moveFocus(box, step) {
    var links = Array.prototype.slice.call(box.list.querySelectorAll("a"));
    if (!links.length) return;
    var at = links.indexOf(document.activeElement);
    if (at < 0) { links[step > 0 ? 0 : links.length - 1].focus(); return; }
    var next = at + step;
    if (next < 0) box.input.focus();
    else links[Math.min(next, links.length - 1)].focus();
  }

  function closeResults(box) {
    box.list.hidden = true;
  }

  function setUpSearch() {
    var src = document.body.getAttribute("data-search-index");
    var root = document.body.getAttribute("data-search-root") || "";
    var anchor = document.querySelector(".site-header .lang");
    if (!src || !anchor) return;
    var box = buildSearchBox();
    anchor.parentNode.insertBefore(box.form, anchor);
    var index = null;

    function render() {
      var results = search(index || [], box.input.value);
      box.list.textContent = "";
      results.forEach(function (result) { box.list.appendChild(resultItem(result, root)); });
      var empty = !box.input.value.trim();
      box.list.hidden = empty;
      box.status.textContent = empty ? "" : countText(results.length);
    }

    box.input.addEventListener("focus", function () {
      if (index === null) loadIndex(src, function (loaded) { index = loaded; render(); });
    });
    box.input.addEventListener("input", function () { if (index !== null) render(); });
    box.form.addEventListener("submit", function (event) {
      event.preventDefault();
      var first = box.list.querySelector("a");
      if (first) first.focus();
    });
    box.form.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(box, 1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(box, -1); }
      else if (event.key === "Escape") { closeResults(box); box.input.focus(); }
    });
    box.form.addEventListener("focusout", function (event) {
      if (!box.form.contains(event.relatedTarget)) closeResults(box);
    });
    box.input.addEventListener("focus", function () { if (box.input.value.trim() && index !== null) render(); });
    document.addEventListener("keydown", function (event) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(document.activeElement)) return;
      event.preventDefault();
      box.input.focus();
    });
  }

  function setUp() {
    announcer = document.createElement("p");
    announcer.className = "visually-hidden";
    announcer.setAttribute("aria-live", "polite");
    document.body.appendChild(announcer);
    setUpMenu();
    setUpCopyButtons();
    setUpSearch();
  }

  document.documentElement.className = document.documentElement.className.replace("no-js", "js");
  document.addEventListener("DOMContentLoaded", setUp);
})(typeof window !== "undefined" ? window : this);
