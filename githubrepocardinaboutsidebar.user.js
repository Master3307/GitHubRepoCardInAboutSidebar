// ==UserScript==
// @name         GitHub Repo Card in About Sidebar
// @namespace    master3307/github-repo-card
// @version      1.0.0
// @description  Adds a GitHub API-powered repository card beneath the About sidebar section.
// @match        https://github.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.github.com
// ==/UserScript==

(() => {
  "use strict";

  const TOKEN_KEY = "github_repo_card_token";
  const CARD_ID = "master3307-github-repo-card";
  const CACHE_PREFIX = "github_repo_card_cache:";
  const CACHE_TTL_MS = 15 * 60 * 1000;

  GM_addStyle(`
      #${CARD_ID} {
        display: block;
        margin-top: 16px;
        padding: 13px;
        border: 1px solid var(--borderColor-default, #30363d);
        border-radius: 13px;
        background: var(--bgColor-muted, #161b22);
        color: var(--fgColor-default, #f0f6fc);
        text-decoration: none;
        transition: border-color 120ms ease, background-color 120ms ease;
      }

      #${CARD_ID}:hover {
        border-color: var(--borderColor-accent-emphasis, #1f6feb);
        background: var(--bgColor-neutral-muted, #21262d);
        text-decoration: none;
      }

      #${CARD_ID} .ghrc-top {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-width: 0;
      }

      #${CARD_ID} .ghrc-avatar {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        border-radius: 50%;
      }

      #${CARD_ID} .ghrc-main {
        min-width: 0;
        flex: 1;
      }

      #${CARD_ID} .ghrc-name-row {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }

      #${CARD_ID} .ghrc-name {
        overflow: hidden;
        color: var(--fgColor-default, #f0f6fc);
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${CARD_ID} .ghrc-private {
        flex: 0 0 auto;
        padding: 1px 5px;
        border: 1px solid var(--borderColor-default, #30363d);
        border-radius: 999px;
        color: var(--fgColor-muted, #8b949e);
        font-size: 11px;
        line-height: 16px;
      }

      #${CARD_ID} .ghrc-description {
        display: -webkit-box;
        margin-top: 7px;
        overflow: hidden;
        color: var(--fgColor-muted, #8b949e);
        font-size: 12px;
        line-height: 18px;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      #${CARD_ID} .ghrc-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        margin-top: 10px;
        color: var(--fgColor-muted, #8b949e);
        font-size: 12px;
        line-height: 16px;
      }

      #${CARD_ID} .ghrc-language {
        max-width: 125px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #${CARD_ID} .ghrc-settings {
        float: right;
        padding: 0;
        border: 0;
        color: var(--fgColor-muted, #8b949e);
        background: transparent;
        cursor: pointer;
        font-size: 12px;
      }

      #${CARD_ID} .ghrc-settings:hover {
        color: var(--fgColor-accent, #58a6ff);
      }

      #${CARD_ID} .ghrc-error {
        color: var(--fgColor-muted, #8b949e);
        font-size: 12px;
        line-height: 18px;
      }
    `);

  function getCurrentRepository() {
    const parts = location.pathname.split("/").filter(Boolean);

    // A repository root is exactly /owner/repository.
    // Do not inject on /owner/repo/issues, /blob/, /settings, etc.
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

  function formatNumber(value) {
    return new Intl.NumberFormat(undefined, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value || 0);
  }

  function makeCard(repository) {
    const card = document.createElement("a");
    card.id = CARD_ID;
    card.href = repository.html_url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.title = `Open ${repository.full_name}`;

    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "ghrc-settings";
    settings.textContent = "Token";
    settings.title = "Configure GitHub token";
    settings.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      configureToken();
    });

    const top = document.createElement("div");
    top.className = "ghrc-top";

    const avatar = document.createElement("img");
    avatar.className = "ghrc-avatar";
    avatar.src = repository.owner.avatar_url;
    avatar.alt = "";
    avatar.referrerPolicy = "no-referrer";

    const main = document.createElement("div");
    main.className = "ghrc-main";

    const nameRow = document.createElement("div");
    nameRow.className = "ghrc-name-row";

    const name = textElement("span", "ghrc-name", repository.full_name);
    nameRow.append(name);

    if (repository.private) {
      nameRow.append(textElement("span", "ghrc-private", "Private"));
    }

    main.append(nameRow);

    if (repository.description) {
      main.append(
        textElement("div", "ghrc-description", repository.description),
      );
    }

    const stats = document.createElement("div");
    stats.className = "ghrc-stats";

    if (repository.language) {
      stats.append(textElement("span", "ghrc-language", repository.language));
    }

    stats.append(
      textElement("span", "", `★ ${formatNumber(repository.stargazers_count)}`),
    );

    stats.append(
      textElement("span", "", `⑂ ${formatNumber(repository.forks_count)}`),
    );

    main.append(stats);
    top.append(avatar, main);
    card.append(settings, top);

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
        "GitHub denied this request. Your token may lack access, require organization approval, or be rate-limited.";
    } else {
      card.textContent = `Could not load repository card${error.status ? ` (${error.status})` : ""}.`;
    }

    return card;
  }

  function findAboutSection() {
    const headings = [...document.querySelectorAll("h2")];

    const aboutHeading = headings.find(
      (heading) => heading.textContent.trim() === "About",
    );

    return aboutHeading?.closest(
      ".SidebarSection-module__sidebarSection__e8jFN",
    );
  }

  async function injectCard() {
    const current = getCurrentRepository();
    if (!current || document.getElementById(CARD_ID)) return;

    const aboutSection = findAboutSection();
    if (!aboutSection) return;

    const placeholder = document.createElement("div");
    placeholder.id = CARD_ID;
    placeholder.className = "ghrc-error";
    placeholder.textContent = "Loading repository card…";
    aboutSection.append(placeholder);

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
    if (card) card.remove();

    injectCard();
  }

  GM_registerMenuCommand("Configure GitHub repo-card token", configureToken);

  GM_registerMenuCommand("Remove GitHub repo-card token", () => {
    setToken("");
    alert("The saved GitHub repo-card token was removed.");
  });

  injectCard();

  new MutationObserver(() => injectCard()).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
