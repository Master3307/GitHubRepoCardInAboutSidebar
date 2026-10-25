// ==UserScript==
// @name         GitHub Social Preview Card in About Sidebar
// @namespace    https://github.com/Master3307/GitHubRepoCardInAboutSidebar
// @version      2.0.1
// @author       MrKoby07
// @description  Adds a repository social-preview image card below the desktop and mobile About headings on GitHub repository home pages
// @license      MIT
// @match        https://github.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @homepageURL  https://github.com/Master3307/GitHubRepoCardInAboutSidebar
// @supportURL   https://github.com/Master3307/GitHubRepoCardInAboutSidebar/issues
// @icon         https://github.com/favicon.ico
// @updateURL    https://github.com/Master3307/GitHubRepoCardInAboutSidebar/raw/refs/heads/master/githubrepocardinaboutsidebar.user.js
// @downloadURL  https://github.com/Master3307/GitHubRepoCardInAboutSidebar/raw/refs/heads/master/githubrepocardinaboutsidebar.user.js
// ==/UserScript==

(() => {
  "use strict";

  const VERSION = "2.0.1";
  const LOG = "[GitHub Repo Card]";

  const TOKEN_KEY = "github_repo_card_token";
  const TOKEN_BUTTON_VISIBLE_KEY = "github_repo_card_token_button_visible";
  const FOOTER_VISIBLE_KEY = "github_repo_card_footer_visible";

  const CARD_ID = "master3307-github-repo-card";
  const CARD_SELECTOR = `[data-ghrc-card="${CARD_ID}"]`;
  const STYLE_ID = `${CARD_ID}-style`;

  const CACHE_PREFIX = "github_repo_card_cache:";
  const CACHE_TTL_MS = 15 * 60 * 1000;

  const pendingRequests = new Map();
  const requestedCards = new WeakSet();
  const memorySettings = new Map();

  let scheduledTimer = null;

  document.documentElement.setAttribute("data-ghrc-started", VERSION);
  console.info(`${LOG} Started v${VERSION}`);

  function getValue(key, fallback) {
    try {
      if (typeof GM_getValue === "function") {
        return GM_getValue(key, fallback);
      }
    } catch (error) {
      console.warn(`${LOG} Failed to read setting`, key, error);
    }

    return memorySettings.has(key) ? memorySettings.get(key) : fallback;
  }

  function setValue(key, value) {
    memorySettings.set(key, value);

    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
      }
    } catch (error) {
      console.warn(`${LOG} Failed to save setting`, key, error);
    }
  }

  function registerMenu(label, callback) {
    try {
      if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand(label, callback);
      }
    } catch (error) {
      console.warn(`${LOG} Failed to register menu`, label, error);
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      ${CARD_SELECTOR} {
        display: block;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        margin: 8px 0 16px;
        overflow: hidden;
        border: 1px solid var(--borderColor-default, #30363d);
        border-radius: 13px;
        background: var(--bgColor-muted, #161b22);
        color: var(--fgColor-default, #f0f6fc);
        transition: border-color 120ms ease, background-color 120ms ease;
      }

      ${CARD_SELECTOR}:hover {
        border-color: var(--borderColor-accent-emphasis, #1f6feb);
        background: var(--bgColor-neutral-muted, #21262d);
      }

      ${CARD_SELECTOR} .ghrc-preview-link {
        display: block;
        color: inherit;
        text-decoration: none;
      }

      ${CARD_SELECTOR} .ghrc-preview-link:hover .ghrc-preview {
        filter: brightness(0.92);
      }

      ${CARD_SELECTOR} .ghrc-preview {
        display: block;
        width: 100%;
        aspect-ratio: 2 / 1;
        background: var(--bgColor-inset, #010409);
        object-fit: cover;
        transition: filter 120ms ease;
      }

      ${CARD_SELECTOR} .ghrc-footer {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        padding: 9px 10px;
        border-top: 1px solid var(--borderColor-default, #30363d);
      }

      ${CARD_SELECTOR} [hidden] {
        display: none !important;
      }

      ${CARD_SELECTOR} .ghrc-name {
        min-width: 0;
        overflow: hidden;
        color: var(--fgColor-default, #f0f6fc);
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      ${CARD_SELECTOR} .ghrc-name:hover {
        color: var(--fgColor-accent, #58a6ff);
        text-decoration: none;
      }

      ${CARD_SELECTOR} .ghrc-private {
        flex: 0 0 auto;
        padding: 1px 5px;
        border: 1px solid var(--borderColor-default, #30363d);
        border-radius: 999px;
        color: var(--fgColor-muted, #8b949e);
        font-size: 10px;
        line-height: 14px;
      }

      ${CARD_SELECTOR} .ghrc-settings {
        flex: 0 0 auto;
        margin-left: auto;
        padding: 0;
        border: 0;
        color: var(--fgColor-muted, #8b949e);
        background: transparent;
        cursor: pointer;
        font-size: 11px;
        line-height: 18px;
      }

      ${CARD_SELECTOR} .ghrc-settings:hover {
        color: var(--fgColor-accent, #58a6ff);
      }

      ${CARD_SELECTOR} .ghrc-image-error {
        display: block;
        padding: 12px;
        color: var(--fgColor-muted, #8b949e);
        font-size: 12px;
        line-height: 1.5;
      }
    `;

    (document.head || document.documentElement).append(style);
  }

  function getCurrentRepository() {
    if (location.hostname !== "github.com") return null;

    const parts = location.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;

    const [owner, repo] = parts;
    const fullName = `${owner}/${repo}`;

    return {
      owner,
      repo,
      fullName,
      key: fullName.toLowerCase(),
      url: `https://github.com/${fullName}`,
    };
  }

  function isCurrentRepository(current) {
    return getCurrentRepository()?.key === current.key;
  }

  function findAboutHeadings() {
    const root =
      document.querySelector('react-app[app-name="code-view"]') ||
      document.querySelector("#repo-content-pjax-container") ||
      document.querySelector("main") ||
      document;

    return [...root.querySelectorAll("h2")].filter((heading) => {
      return (
        heading.textContent.trim().replace(/\s+/g, " ") === "About" &&
        !heading.closest("article, .markdown-body") &&
        !heading.closest(CARD_SELECTOR)
      );
    });
  }

  function getFallbackUrl(fullName) {
    const path = fullName
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");

    return `https://opengraph.githubassets.com/1/${path}`;
  }

  function safeImageUrl(value) {
    if (typeof value !== "string" || !value.trim()) return null;

    try {
      const url = new URL(value.trim(), location.origin);
      return url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  function getPageImage(current) {
    const metadataPage = document.querySelector(
      'meta[property="og:url"]',
    )?.content;

    // Avoid reusing another repository's metadata during soft navigation.
    if (!metadataPage) return null;

    try {
      const url = new URL(metadataPage, location.origin);

      if (
        url.hostname !== "github.com" ||
        url.pathname.replace(/\/$/, "").toLowerCase() !== `/${current.key}`
      ) {
        return null;
      }
    } catch {
      return null;
    }

    for (const selector of [
      'meta[property="og:image:secure_url"]',
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ]) {
      const imageUrl = safeImageUrl(document.querySelector(selector)?.content);

      if (imageUrl) return imageUrl;
    }

    return null;
  }

  function getCachedRepository(current) {
    const cached = getValue(`${CACHE_PREFIX}${current.key}`, null);

    if (
      !cached?.data ||
      typeof cached.savedAt !== "number" ||
      Date.now() - cached.savedAt > CACHE_TTL_MS
    ) {
      return null;
    }

    return cached.data;
  }

  function fetchRepository(current) {
    const cached = getCachedRepository(current);

    if (cached) return Promise.resolve(cached);

    if (pendingRequests.has(current.key)) {
      return pendingRequests.get(current.key);
    }

    if (typeof GM_xmlhttpRequest !== "function") {
      return Promise.reject(new Error("GM_xmlhttpRequest is unavailable"));
    }

    const token = String(getValue(TOKEN_KEY, "") || "").trim();

    const request = new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url:
          "https://api.github.com/repos/" +
          encodeURIComponent(current.owner) +
          "/" +
          encodeURIComponent(current.repo),
        responseType: "json",
        timeout: 15000,
        headers: {
          Accept: "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        onload(response) {
          let data = response.response;

          if (!data || typeof data !== "object") {
            try {
              data = JSON.parse(response.responseText);
            } catch {
              data = null;
            }
          }

          if (
            response.status >= 200 &&
            response.status < 300 &&
            typeof data?.full_name === "string"
          ) {
            setValue(`${CACHE_PREFIX}${current.key}`, {
              savedAt: Date.now(),
              data,
            });

            resolve(data);
            return;
          }

          reject(
            new Error(
              `GitHub API ${response.status}: ${
                data?.message || response.statusText || "Request failed"
              }`,
            ),
          );
        },
        onerror() {
          reject(new Error("GitHub API network request failed"));
        },
        ontimeout() {
          reject(new Error("GitHub API request timed out"));
        },
      });
    });

    pendingRequests.set(current.key, request);

    const cleanup = () => {
      if (pendingRequests.get(current.key) === request) {
        pendingRequests.delete(current.key);
      }
    };

    request.then(cleanup, cleanup);
    return request;
  }

  function updatePreferences(card) {
    const footer = card.querySelector(".ghrc-footer");
    const settings = card.querySelector(".ghrc-settings");

    if (footer) {
      footer.hidden = !getValue(FOOTER_VISIBLE_KEY, true);
    }

    if (settings) {
      settings.hidden = !getValue(TOKEN_BUTTON_VISIBLE_KEY, true);
    }
  }

  function setPreviewImage(card, imageUrl) {
    const image = card.querySelector(".ghrc-preview");
    const link = card.querySelector(".ghrc-preview-link");
    const error = card.querySelector(".ghrc-image-error");

    if (!image || !link) return;
    if (image.getAttribute("src") === imageUrl) return;

    delete image.dataset.fallbackTried;
    image.hidden = false;

    if (error) error.hidden = true;

    link.href = imageUrl;
    image.src = imageUrl;
  }

  function makeCard(current) {
    const card = document.createElement("div");
    card.setAttribute("data-ghrc-card", CARD_ID);
    card.dataset.repo = current.fullName;
    card.dataset.repoKey = current.key;

    const previewLink = document.createElement("a");
    previewLink.className = "ghrc-preview-link";
    previewLink.target = "_blank";
    previewLink.rel = "noopener noreferrer";
    previewLink.title = "Open social-preview image";

    const image = document.createElement("img");
    image.className = "ghrc-preview";
    image.alt = `${current.fullName} social preview`;
    image.loading = "eager";
    image.decoding = "async";

    const imageError = document.createElement("span");
    imageError.className = "ghrc-image-error";
    imageError.textContent =
      "Social-preview image could not be loaded. Click to open it.";
    imageError.hidden = true;

    image.addEventListener("load", () => {
      image.hidden = false;
      imageError.hidden = true;
    });

    image.addEventListener("error", () => {
      const fallback = getFallbackUrl(card.dataset.repo);

      if (
        image.getAttribute("src") !== fallback &&
        image.dataset.fallbackTried !== "true"
      ) {
        image.dataset.fallbackTried = "true";
        previewLink.href = fallback;
        image.src = fallback;
        return;
      }

      image.hidden = true;
      imageError.hidden = false;

      console.warn(`${LOG} Preview image failed`, {
        repository: card.dataset.repo,
        imageUrl: image.getAttribute("src"),
      });
    });

    previewLink.append(image, imageError);

    const footer = document.createElement("div");
    footer.className = "ghrc-footer";

    const repoLink = document.createElement("a");
    repoLink.className = "ghrc-name";
    repoLink.href = current.url;
    repoLink.target = "_blank";
    repoLink.rel = "noopener noreferrer";
    repoLink.textContent = current.fullName;
    repoLink.title = `Open ${current.fullName}`;

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "ghrc-settings";
    settings.textContent = "Token";
    settings.title = "Configure GitHub token";
    settings.addEventListener("click", configureToken);

    footer.append(repoLink, settings);
    card.append(previewLink, footer);

    updatePreferences(card);
    setPreviewImage(
      card,
      getPageImage(current) || getFallbackUrl(current.fullName),
    );

    return card;
  }

  function upgradeCard(card, current, repository) {
    if (!card.isConnected || !isCurrentRepository(current)) return;

    card.dataset.repo = repository.full_name;

    const repoLink = card.querySelector(".ghrc-name");
    const footer = card.querySelector(".ghrc-footer");
    const settings = card.querySelector(".ghrc-settings");
    const badge = card.querySelector(".ghrc-private");

    if (repoLink) {
      repoLink.href = repository.html_url || current.url;
      repoLink.textContent = repository.full_name;
      repoLink.title = `Open ${repository.full_name}`;
    }

    if (repository.private && !badge && footer) {
      const privateBadge = document.createElement("span");
      privateBadge.className = "ghrc-private";
      privateBadge.textContent = "Private";
      footer.insertBefore(privateBadge, settings || null);
    } else if (!repository.private) {
      badge?.remove();
    }

    const image = card.querySelector(".ghrc-preview");

    if (image) {
      image.alt = `${repository.full_name} social preview`;
    }

    const preferredImage =
      getPageImage(current) ||
      safeImageUrl(repository.social_preview_image_url);

    if (preferredImage) {
      setPreviewImage(card, preferredImage);
    }

    updatePreferences(card);
  }

  function requestMetadata(card, current) {
    if (requestedCards.has(card)) return;
    requestedCards.add(card);

    fetchRepository(current)
      .then((repository) => {
        upgradeCard(card, current, repository);
      })
      .catch((error) => {
        if (card.isConnected && isCurrentRepository(current)) {
          console.warn(
            `${LOG} Metadata unavailable; keeping preview`,
            error.message,
          );
        }
      });
  }

  function removeCards() {
    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      card.remove();
    });

    document.getElementById(CARD_ID)?.remove();
  }

  function reconcile() {
    const current = getCurrentRepository();

    if (!current) {
      removeCards();
      return;
    }

    ensureStyle();

    const headings = findAboutHeadings();

    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      const correctlyPlaced = headings.some(
        (heading) => heading.nextElementSibling === card,
      );

      if (card.dataset.repoKey !== current.key || !correctlyPlaced) {
        card.remove();
      }
    });

    // Remove any single-ID card left behind by an older version.
    document.getElementById(CARD_ID)?.remove();

    for (const heading of headings) {
      let card = heading.nextElementSibling;

      if (
        !card?.matches(CARD_SELECTOR) ||
        card.dataset.repoKey !== current.key
      ) {
        card = makeCard(current);
        heading.insertAdjacentElement("afterend", card);

        console.info(`${LOG} Card inserted`, {
          repository: current.fullName,
          headingVisible: heading.getClientRects().length > 0,
        });
      }

      updatePreferences(card);
      requestMetadata(card, current);
    }

    const count = String(document.querySelectorAll(CARD_SELECTOR).length);

    if (
      document.documentElement.getAttribute("data-ghrc-card-count") !== count
    ) {
      document.documentElement.setAttribute("data-ghrc-card-count", count);
    }
  }

  function runSafely() {
    try {
      reconcile();
    } catch (error) {
      console.error(`${LOG} Insertion failed`, error);
    }
  }

  function schedule() {
    if (scheduledTimer !== null) return;

    scheduledTimer = window.setTimeout(() => {
      scheduledTimer = null;
      runSafely();
    }, 100);
  }

  function refreshCards() {
    removeCards();
    runSafely();
  }

  function configureToken() {
    const existing = String(getValue(TOKEN_KEY, "") || "");

    const next = window.prompt(
      existing
        ? "Paste a replacement GitHub token, or leave blank to remove the saved token."
        : "Paste a fine-grained GitHub token. It is saved in this userscript manager.",
      "",
    );

    if (next === null) return;

    setValue(TOKEN_KEY, next.trim());
    refreshCards();
  }

  function togglePreference(key) {
    setValue(key, !getValue(key, true));

    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
      updatePreferences(card);
    });
  }

  function showDiagnostics() {
    const report = {
      version: VERSION,
      path: location.pathname,
      aboutHeadings: findAboutHeadings().length,
      cards: document.querySelectorAll(CARD_SELECTOR).length,
      stylesheetPresent: Boolean(document.getElementById(STYLE_ID)),
      tokenConfigured: Boolean(getValue(TOKEN_KEY, "")),
      footerVisible: getValue(FOOTER_VISIBLE_KEY, true),
      tokenButtonVisible: getValue(TOKEN_BUTTON_VISIBLE_KEY, true),
      apiAvailable: typeof GM_xmlhttpRequest === "function",
    };

    console.info(`${LOG} Diagnostics`, report);
    window.alert(JSON.stringify(report, null, 2));
  }

  registerMenu("Toggle footer visibility", () => {
    togglePreference(FOOTER_VISIBLE_KEY);
  });

  registerMenu("Toggle Token button visibility", () => {
    togglePreference(TOKEN_BUTTON_VISIBLE_KEY);
  });

  registerMenu("Configure GitHub repo-card token", configureToken);

  registerMenu("Remove GitHub repo-card token", () => {
    setValue(TOKEN_KEY, "");
    refreshCards();
    window.alert("The saved GitHub repo-card token was removed.");
  });

  registerMenu("Refresh GitHub repo cards", refreshCards);
  registerMenu("Show GitHub repo-card diagnostics", showDiagnostics);

  for (const event of [
    "turbo:load",
    "turbo:render",
    "pjax:end",
    "soft-nav:end",
  ]) {
    document.addEventListener(event, schedule);
  }

  window.addEventListener("pageshow", schedule);
  window.addEventListener("popstate", schedule);
  window.addEventListener("resize", schedule);

  document.addEventListener("turbo:before-cache", () => {
    if (scheduledTimer !== null) {
      window.clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }

    removeCards();
  });

  const observer = new MutationObserver(schedule);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  let lastPath = location.pathname;

  window.setInterval(() => {
    const pathChanged = location.pathname !== lastPath;
    lastPath = location.pathname;

    if (pathChanged || getCurrentRepository()) {
      schedule();
    }
  }, 2000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runSafely, {
      once: true,
    });
  } else {
    runSafely();
  }
})();
