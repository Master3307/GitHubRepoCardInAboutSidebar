// ==UserScript==
// @name         GitHub Social Preview Card in About Sidebar
// @namespace    https://github.com/
// @version      1.4.0
// @author       MrKoby07
// @description  Adds a repository social-preview image card directly below the About heading on GitHub repository home pages
// @license      MIT
// @match        https://github.com/*/*
// @match        https://github.com/*/*/
// @exclude      https://github.com/*/*/blob/*
// @exclude      https://github.com/*/*/tree/*
// @exclude      https://github.com/*/*/issues*
// @exclude      https://github.com/*/*/pull*
// @exclude      https://github.com/*/*/actions*
// @exclude      https://github.com/*/*/projects*
// @exclude      https://github.com/*/*/wiki*
// @exclude      https://github.com/*/*/settings*
// @exclude      https://github.com/*/*/security*
// @exclude      https://github.com/*/*/network*
// @exclude      https://github.com/*/*/stargazers*
// @exclude      https://github.com/*/*/watchers*
// @exclude      https://github.com/*/*/forks*
// @exclude      https://github.com/*/*/releases*
// @exclude      https://github.com/*/*/tags*
// @exclude      https://github.com/*/*/commits*
// @exclude      https://github.com/*/*/branches*
// @exclude      https://github.com/*/*/compare/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.github.com
// @homepageURL  https://github.com/Master3307/GitHubRepoCardInAboutSidebar
// @supportURL   https://github.com/Master3307/GitHubRepoCardInAboutSidebar/issues
// @icon         https://github.com/favicon.ico
// @updateURL    https://github.com/Master3307/GitHubRepoCardInAboutSidebar/raw/refs/heads/master/githubrepocardinaboutsidebar.user.js
// @downloadURL  https://github.com/Master3307/GitHubRepoCardInAboutSidebar/raw/refs/heads/master/githubrepocardinaboutsidebar.user.js
// ==/UserScript==

(() => {
  "use strict";

  const TOKEN_KEY = "github_repo_card_token";
  const CARD_ID = "master3307-github-repo-card";
  const CACHE_PREFIX = "github_repo_card_cache:";
  const CACHE_TTL_MS = 15 * 60 * 1000;

  GM_addStyle(`
      #${CARD_ID} {
        margin: 8px 0 16px;
        overflow: hidden;
        border: 1px solid var(--borderColor-default, #30363d);
        border-radius: 13px;
        background: var(--bgColor-muted, #161b22);
        color: var(--fgColor-default, #f0f6fc);
        transition: border-color 120ms ease, background-color 120ms ease;
      }

      #${CARD_ID}:hover {
        border-color: var(--borderColor-accent-emphasis, #1f6feb);
        background: var(--bgColor-neutral-muted, #21262d);
      }

      #${CARD_ID} .ghrc-preview-link {
        display: block;
        color: inherit;
        text-decoration: none;
      }

      #${CARD_ID} .ghrc-preview-link:hover .ghrc-preview {
        filter: brightness(0.92);
      }

      #${CARD_ID} .ghrc-preview {
        display: block;
        width: 100%;
        aspect-ratio: 2 / 1;
        background: var(--bgColor-inset, #010409);
        object-fit: cover;
        transition: filter 120ms ease;
      }

      #${CARD_ID} .ghrc-preview[hidden] {
        display: none;
      }

      #${CARD_ID} .ghrc-footer {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        padding: 9px 10px;
        border-top: 1px solid var(--borderColor-default, #30363d);
      }

      #${CARD_ID} .ghrc-name {
        min-width: 0;
        overflow: hidden;
        color: var(--fgColor-default, #f0f6fc);
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${CARD_ID} .ghrc-name:hover {
        color: var(--fgColor-accent, #58a6ff);
        text-decoration: none;
      }

      #${CARD_ID} .ghrc-private {
        flex: 0 0 auto;
        padding: 1px 5px;
        border: 1px solid var(--borderColor-default, #30363d);
        border-radius: 999px;
        color: var(--fgColor-muted, #8b949e);
        font-size: 10px;
        line-height: 14px;
      }

      #${CARD_ID} .ghrc-settings {
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

      #${CARD_ID} .ghrc-settings:hover {
        color: var(--fgColor-accent, #58a6ff);
      }

      #${CARD_ID} .ghrc-error {
        padding: 13px;
        color: var(--fgColor-muted, #8b949e);
        font-size: 12px;
        line-height: 18px;
      }
    `);

  function getCurrentRepository() {
    const parts = location.pathname.split("/").filter(Boolean);

    // Only run at /owner/repository.
    // Ignore /issues, /pulls, /blob, /settings, and other subpages.
    if (parts.length !== 2) return null;

    const [owner, repo] = parts;

    if (!owner || !repo) return null;

    return {
      owner,
      repo,
      fullName: `${owner}/${repo}`,
    };
  }

  function getToken() {
    return GM_getValue(TOKEN_KEY, "");
  }

  function setToken(token) {
    GM_setValue(TOKEN_KEY, token.trim());
  }

  function cacheKey(fullName) {
    return `${CACHE_PREFIX}${fullName.toLowerCase()}`;
  }

  function getCachedRepo(fullName) {
    const cached = GM_getValue(cacheKey(fullName), null);

    if (!cached || Date.now() - cached.savedAt > CACHE_TTL_MS) {
      return null;
    }

    return cached.data;
  }

  function saveCachedRepo(fullName, data) {
    GM_setValue(cacheKey(fullName), {
      savedAt: Date.now(),
      data,
    });
  }

  function apiRequest(path) {
    const token = getToken();

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: `https://api.github.com${path}`,
        responseType: "json",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.response);
            return;
          }

          reject({
            status: response.status,
            message: response.response?.message || response.statusText,
          });
        },
        onerror() {
          reject({
            status: 0,
            message: "Network request failed",
          });
        },
      });
    });
  }

  async function fetchRepository(owner, repo) {
    const fullName = `${owner}/${repo}`;
    const cached = getCachedRepo(fullName);

    if (cached) return cached;

    const data = await apiRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );

    saveCachedRepo(fullName, data);
    return data;
  }

  function textElement(tagName, className, text) {
    const element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function getPageSocialPreviewUrl() {
    const selectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
    ];

    for (const selector of selectors) {
      const imageUrl = document.querySelector(selector)?.content?.trim();

      if (imageUrl) {
        return imageUrl;
      }
    }

    return null;
  }

  function getSocialPreviewUrl(repository) {
    return (
      getPageSocialPreviewUrl() ||
      repository.social_preview_image_url ||
      `https://opengraph.githubassets.com/1/${repository.full_name}`
    );
  }

  function makeCard(repository) {
    const card = document.createElement("div");
    card.id = CARD_ID;

    const imageUrl = getSocialPreviewUrl(repository);

    const previewLink = document.createElement("a");
    previewLink.className = "ghrc-preview-link";
    previewLink.href = imageUrl;
    previewLink.target = "_blank";
    previewLink.rel = "noopener noreferrer";
    previewLink.title = "Open social-preview image";

    const preview = document.createElement("img");
    preview.className = "ghrc-preview";
    preview.src = imageUrl;
    preview.alt = `${repository.full_name} social preview`;
    preview.loading = "lazy";

    preview.addEventListener("error", () => {
      preview.hidden = true;
    });

    previewLink.append(preview);

    const footer = document.createElement("div");
    footer.className = "ghrc-footer";

    const repoLink = document.createElement("a");
    repoLink.className = "ghrc-name";
    repoLink.href = repository.html_url;
    repoLink.target = "_blank";
    repoLink.rel = "noopener noreferrer";
    repoLink.textContent = repository.full_name;
    repoLink.title = `Open ${repository.full_name}`;

    footer.append(repoLink);

    if (repository.private) {
      footer.append(textElement("span", "ghrc-private", "Private"));
    }

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "ghrc-settings";
    settings.textContent = "Token";
    settings.title = "Configure GitHub token";

    settings.addEventListener("click", () => {
      configureToken();
    });

    footer.append(settings);
    card.append(previewLink, footer);

    return card;
  }

  function makeErrorCard(error) {
    const card = document.createElement("div");
    card.id = CARD_ID;
    card.className = "ghrc-error";

    if (error.status === 404) {
      card.textContent =
        "Repository metadata is unavailable. Configure a GitHub token if this is a private repository.";
    } else if (error.status === 401) {
      card.textContent =
        "Your GitHub token was rejected. Open the userscript menu and replace it.";
    } else if (error.status === 403) {
      card.textContent =
        "GitHub denied this request. Your token may lack repository access, require organization approval, or be rate-limited.";
    } else {
      card.textContent = `Could not load repository card${error.status ? ` (${error.status})` : ""}.`;
    }

    return card;
  }

  function findAboutHeading() {
    const headings = [...document.querySelectorAll("h2")];

    return headings.find((heading) => heading.textContent.trim() === "About");
  }

  async function injectCard() {
    const current = getCurrentRepository();

    if (!current || document.getElementById(CARD_ID)) return;

    const aboutHeading = findAboutHeading();
    if (!aboutHeading) return;

    const placeholder = document.createElement("div");
    placeholder.id = CARD_ID;
    placeholder.className = "ghrc-error";
    placeholder.textContent = "Loading social preview…";

    // Place the card directly after the About heading.
    // This puts it before the repository description and every other sidebar item.
    aboutHeading.insertAdjacentElement("afterend", placeholder);

    try {
      const repository = await fetchRepository(current.owner, current.repo);

      if (location.pathname !== `/${current.owner}/${current.repo}`) return;

      placeholder.replaceWith(makeCard(repository));
    } catch (error) {
      placeholder.replaceWith(makeErrorCard(error));
    }
  }

  function configureToken() {
    const currentToken = getToken();

    const nextToken = prompt(
      currentToken
        ? "Paste a replacement token, or leave this blank to remove the saved token."
        : "Paste a fine-grained GitHub token. It is stored only in this userscript manager.",
      "",
    );

    if (nextToken === null) return;

    setToken(nextToken);

    const card = document.getElementById(CARD_ID);

    if (card) {
      card.remove();
    }

    injectCard();
  }

  GM_registerMenuCommand("Configure GitHub repo-card token", configureToken);

  GM_registerMenuCommand("Remove GitHub repo-card token", () => {
    setToken("");
    alert("The saved GitHub repo-card token was removed.");
  });

  injectCard();

  new MutationObserver(() => {
    injectCard();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
