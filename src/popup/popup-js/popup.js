/**
 * Close the menu's overlay: slide div up and update button svg
 */
const closeMenu = () => {
    $("#menuDiv").slideUp({
        duration: 300,
        easing: "easeOutQuint",
    }) &&
        $("#tabler-menu").fadeOut(() => {
            $("#tabler-menu").html(/*html*/ `
                <svg class="tabler-icon">
                    <use xlink:href="../../icons/tabler-sprite-nostroke.svg#tabler-adjustments" />
                </svg>
            `);
            $("#tabler-menu").fadeIn();
        });
    STATE.menuIsOpen = false;
};

/**
 * Open the menu's overlay: slide div down and update button svg
 */
const openMenu = () => {
    $("#menuDiv").slideDown({
        duration: 300,
        easing: "easeOutQuint",
    }) &&
        $("#tabler-menu").fadeOut(() => {
            $("#tabler-menu").html(/*html*/ `
            <svg class="tabler-icon menu-svg">
                <use xlink:href="../../icons/tabler-sprite-nostroke.svg#tabler-circle-x" />
            </svg>`);
            $("#tabler-menu").fadeIn();
        });
    STATE.menuIsOpen = true;
};
/**
 * Parses menu options from the storage and adds events listeners for their change.
 * Notably, if a key in `menuCheckNames` is missing from `menu` it is set to true
 * @param {object} menu The menu retrieved from storage
 * @param {string []} menuCheckNames The array of all expected menu options
 */
const getAndTrackPopupMenuChecks = (menu, menuCheckNames) => {
    let setValues = {};
    for (const key of menuCheckNames) {
        setValues[key] = menu.hasOwnProperty(key) ? menu[key] : true;
        $("#" + key).prop("checked", menu[key]);
    }
    chrome.storage.local.set(setValues);

    for (const key of menuCheckNames) {
        $("#" + key).on("change", () => {
            const checked = $("#" + key).prop("checked");
            chrome.storage.local.set({ [key]: checked }, function () {
                console.log(`Settings saved for ${key} (${checked})`);
            });
        });
    }
};

const setStandardPopupClicks = () => {
    $("#helpGithubLink").on("click", () => {
        chrome.tabs.create({
            url: "https://github.com/vict0rsch/ArxivMemory",
        });
    });

    $("#keyboardShortcuts").on("click", () => {
        chrome.tabs.create({
            url: "https://github.com/vict0rsch/ArxivTools#keyboard-navigation",
        });
    });

    $("#coblock").on("click", () => {
        chrome.tabs.update({
            url: "https://marketplace.visualstudio.com/items?itemName=vict0rsch.coblock",
        });
    });

    $("#tabler-menu").on("click", () => {
        STATE.menuIsOpen ? closeMenu() : openMenu();
    });

    $("#memory-switch").on("click", () => {
        STATE.memoryIsOpen ? closeMemory() : openMemory();
    });

    $("#download-arxivmemory").on("click", () => {
        const now = new Date().toLocaleString();
        chrome.storage.local.get("papers", ({ papers }) => {
            const version = papers.__dataVersion;
            downloadTextFile(
                JSON.stringify(papers),
                `arxiv-memory-${version}-${now}.json`,
                "text/json"
            );
        });
    });
};

const setAndHandleCustomPDFFunction = (menu) => {
    if (menu.pdfTitleFn && typeof menu.pdfTitleFn === "string") {
        STATE.pdfTitleFn = getPdfFn(menu.pdfTitleFn);
    }
    chrome.storage.local.set({ pdfTitleFn: STATE.pdfTitleFn.toString() });
    $("#customPdfTitleTextarea").val(STATE.pdfTitleFn.toString());

    $("#saveCustomPdf").on("click", () => {
        const code = $.trim($("#customPdfTitleTextarea").val());
        try {
            const fn = eval(code);
            fn("test", "1.2");
            $("#customPdfFeedback").html(
                /*html*/ `<span style="color: green">Saved!</span>`
            );
            chrome.storage.local.set({ pdfTitleFn: code });
            STATE.pdfTitleFn = fn;
            setTimeout(() => {
                $("#customPdfFeedback").html("");
            }, 1000);
        } catch (error) {
            $("#customPdfFeedback").html(
                /*html*/ `<span style="color: red">${error}</span>`
            );
        }
    });
    $("#defaultCustomPdf").on("click", () => {
        const code = defaultPDFTitleFn.toString();
        chrome.storage.local.set({ pdfTitleFn: code });
        STATE.pdfTitleFn = defaultPDFTitleFn;
        $("#customPdfTitleTextarea").val(code);
        $("#customPdfFeedback").html(
            /*html*/ `<span style="color: green">Saved!</span>`
        );
        setTimeout(() => {
            $("#customPdfFeedback").html("");
        }, 1000);
    });
};

const main = (url) => {
    $(document).on("keydown", handlePopupKeydown);

    chrome.storage.local.get(menuStorageKeys, (menu) => {
        // Set checkboxes
        getAndTrackPopupMenuChecks(menu, menuCheckNames);

        // Set click events (regardless of paper)
        setStandardPopupClicks();

        // Set PDF title function
        setAndHandleCustomPDFFunction(menu);

        const is = isPaper(url);
        console.log("is: ", is);
        const isKnownPage = Object.values(is).some((i) => i);
        console.log("isKnownPage: ", isKnownPage);

        // Display popup metadata
        if (isKnownPage) {
            $("#notArxiv").hide();
            $("#notPdf").hide();
            $("#isArxiv").show();
            const id = parseIdFromUrl(url);
            STATE.currentId = id;

            chrome.storage.local.get("papers", async ({ papers }) => {
                await initState(papers);
                if (!papers.hasOwnProperty(id)) {
                    // Unknown paper, probably deleted by the user
                    console.log("Unknown id " + id);
                    updatePopupPaperNoMemory();
                    return;
                }

                const paper = STATE.papers[id];
                const eid = paper.id.replace(".", "\\.");

                // -----------------------------
                // -----  Fill Paper Data  -----
                // -----------------------------
                $("#popup-paper-title").text(paper.title);
                $("#popup-authors").text(paper.author);
                if (paper.codeLink) {
                    $("#popup-code-link").show();
                    $("#popup-code-link").text(paper.codeLink);
                }

                // ----------------------------------
                // -----  Customize Popup html  -----
                // ----------------------------------
                $("#popup-memory-edit").append(getPopupItemHTML(paper));
                $("#popup-copy-icons").html(getPopupIconsHTML(paper, url));

                // --------------------------
                // -----  Paper  edits  -----
                // --------------------------
                $(`#popup-item-tags--${eid}`).select2({
                    ...select2Options,
                    width: "87%",
                });
                $("body").css("height", "auto");
                $(`#popup-form-note-textarea--${eid}`).on("focus", () => {
                    var that = this;
                    textareaFocusEnd(that);
                });
                $(`#popup-save-edits--${eid}`).on("click", () => {
                    const note = $(`#popup-form-note-textarea--${eid}`).val();
                    const codeLink = $(`#popup-form-note--${eid}`)
                        .find(".form-code-input")
                        .first()
                        .val();
                    updatePaperTags(id, `#popup-item-tags--${eid}`);
                    saveNote(id, note);
                    saveCodeLink(id, codeLink);
                    $("#popup-feedback-copied").text("Saved tags, code & note!");
                    $("#popup-feedback-copied").fadeIn();
                    setTimeout(() => {
                        $("#popup-feedback-copied").fadeOut();
                    }, 1000);
                });

                // ------------------------
                // -----  SVG clicks  -----
                // ------------------------
                $(`#popup-memory-item-link--${eid}`).on("click", () => {
                    chrome.tabs.update({
                        url: `https://arxiv.org/abs/${paper.id.replace("Arxiv-", "")}`,
                    });
                    window.close();
                });
                $(`#popup-code-link`).on("click", () => {
                    const codeLink = $(`#popup-code-link`).text();
                    if (codeLink) {
                        focusExistingOrCreateNewCodeTab(codeLink);
                    }
                });
                $(`#popup-memory-item-copy-link--${eid}`).on("click", () => {
                    const pdfLink = STATE.papers[id].pdfLink;
                    copyAndConfirmMemoryItem(id, pdfLink, "Pdf link copied!", true);
                });
                $(`#popup-memory-item-md--${eid}`).on("click", () => {
                    const md = STATE.papers[id].md;
                    copyAndConfirmMemoryItem(id, md, "MarkDown link copied!", true);
                });
                $(`#popup-memory-item-bibtex--${eid}`).on("click", () => {
                    const bibtext = formatBibtext(STATE.papers[id].bibtext);
                    copyAndConfirmMemoryItem(
                        id,
                        bibtext,
                        "Bibtex citation copied!",
                        true
                    );
                });
                $(`#popup-memory-item-download--${eid}`).on("click", () => {
                    let pdfTitle = statePdfTitle(paper.title, paper.id);
                    console.log({ pdfTitle });
                    chrome.downloads.download({
                        url: paper.pdfLink,
                        filename: pdfTitle.replaceAll(":", "_"),
                    });
                });
            });
        }
    });
};

$(() => {
    const query = { active: true, lastFocusedWindow: true };
    chrome.tabs.query(query, async (tabs) => {
        main(tabs[0].url);
    });
});
