/**
 * TODO: fix paper popup added/removed to/from favorites => update memory table
 * TODO: remove favorite selection when closing memory
 */

/**
 * Find a JQuery element with class className within #memory-item-container--${eid}
 * @param {string} eid The escaped id for the paper (id.replaceAll(".", "\\."))
 * @param {string} className The class of the element to find within the container with id^
 * @returns {HTMLElement}Jquery element
 */
const findEl = (eid, className) => {
    return document
        .getElementById(`memory-item-container--${eid.replace("\\.", ".")}`)
        .querySelector(`.${className}`);
};

const getTagsHTMLOptions = (paper) => {
    const tags = new Set(paper.tags);
    return Array.from(_state.paperTags)
        .sort()
        .map((t, i) => {
            let h = `<option value="${t}"`;
            if (tags.has(t)) {
                h += ' selected="selected" ';
            }
            return h + `>${t}</option>`;
        })
        .join("");
};

const updatePopupPaperNoMemory = () => {
    const noMemoryHTML = /*html*/ `
    <div style="font-size: 1.5rem;">This paper is not in your memory</div>
    <h4> Refresh the page to add it back </h4>
    `;
    setHTMLEl("isArxiv", noMemoryHTML);
};

/**
 * Delete a paper ; display a modal first to get uer confirmation
 * @param {string} id Id of the paper to delete
 */
const confirmDelete = (id) => {
    const title = _state.papers[id].title;
    document.body.innerHTML += /*html*/ `
    <div id="confirm-modal">
        <div style="width: 80%; padding: 32px 32px; text-align: center; font-size: 1.1rem;">
            Are you sure you want to delete:<p>${title}</p>?
        </div>
        <div style="width: 100%; text-align: center; padding: 32px;">
            <button style="padding: 8px 16px;" id="cancel-modal-button">Cancel</button>
            <span style="min-width: 32px;"></span>
            <button style="padding: 8px 16px;" id="confirm-modal-button--${id}">Confirm</button>
        </div>
    </div>`;
    addListener("cancel-modal-button", "click", handleCancelModalClick);
    addListener(`confirm-modal-button--${id}`, "click", handleConfirmModalClick);
};

/**
 * Copy a text to the clipboard and display a feedback text
 * @param {string} id Id of the paper to display the feedback in the memory item
 * @param {string} textToCopy Text to copy to the clipboard
 * @param {string} feedbackText Text to display as feedback
 * @param {boolean} isPopup If the action took place in the main popup or in the memory
 */
const copyAndConfirmMemoryItem = (id, textToCopy, feedbackText, isPopup) => {
    copyTextToClipboard(textToCopy);
    const element = isPopup
        ? document.getElementById(`popup-feedback-copied`)
        : findEl(id, "memory-item-feedback");
    if (!el) return;
    element.innerText = feedbackText;
    $(element).fadeIn();
    setTimeout(() => {
        $(element).fadeOut();
    }, 1000);
};

/**
 * Looks for an open tab with the code of the paper. Matches are not exact:
 * a tab url needs only to include the codeLink to be valid. If no existing
 * tab matches the codeLink, a new tab is created
 * @param {string} codeLink URL of the code repository to open
 */
const focusExistingOrCreateNewCodeTab = (codeLink) => {
    const { origin } = new URL(codeLink);
    chrome.tabs.query({ url: `${origin}/*` }, (tabs) => {
        for (const tab of tabs) {
            if (tab.url.includes(codeLink)) {
                const tabUpdateProperties = { active: true };
                const windowUpdateProperties = { focused: true };
                chrome.windows.getCurrent((w) => {
                    if (w.id !== tab.windowId) {
                        chrome.windows.update(
                            tab.windowId,
                            windowUpdateProperties,
                            () => {
                                chrome.tabs.update(tab.id, tabUpdateProperties);
                            }
                        );
                    } else {
                        chrome.tabs.update(tab.id, tabUpdateProperties);
                    }
                });
                return;
            }
        }
        chrome.tabs.create({ url: codeLink });
    });
};

/**
 * Looks for an open tab to the paper: either its pdf or html page.
 * If both a pdf and an html page exist, focus the pdf.
 * If none exist, create a new tab.
 * @param {object} paper The paper whose pdf should be opened
 */
const focusExistingOrCreateNewPaperTab = (paper) => {
    const hostname = parseUrl(paper.pdfLink).hostname;

    // create the match string to look for in existing tabs
    let match = paper.pdfLink
        .split("/") // split on parts of the path
        .reverse()[0] // get the last one
        .replace("-Paper.pdf", "") // clean neurips-specific end
        .replace(".pdf", ""); // remove .pdf
    if (match.match(/\d{5}v\d+$/) && paper.source === "arxiv") {
        // remove potential pdf version on arxiv
        match = match.split("v")[0];
    }

    chrome.tabs.query({ url: `*://${hostname}/*` }, (tabs) => {
        let validTabsIds = [];
        let pdfTabsIds = [];
        const urls = tabs.map((t) => t.url);
        let idx = 0;
        for (const u of urls) {
            if (u.indexOf(match) >= 0) {
                validTabsIds.push(idx);
                if (u.endsWith(".pdf")) {
                    pdfTabsIds.push(idx);
                }
            }
            idx += 1;
        }
        if (validTabsIds.length > 0) {
            let tab;
            if (pdfTabsIds.length > 0) {
                tab = tabs[pdfTabsIds[0]];
            } else {
                tab = tabs[validTabsIds[0]];
            }
            const tabUpdateProperties = { active: true };
            const windowUpdateProperties = { focused: true };
            chrome.windows.getCurrent((w) => {
                if (w.id !== tab.windowId) {
                    chrome.windows.update(tab.windowId, windowUpdateProperties, () => {
                        chrome.tabs.update(tab.id, tabUpdateProperties);
                    });
                } else {
                    chrome.tabs.update(tab.id, tabUpdateProperties);
                }
            });
        } else {
            chrome.tabs.create({ url: paper.pdfLink });
        }

        _state.papers[paper.id].count += 1;
        chrome.storage.local.set({ papers: _state.papers });
    });
};

/**
 * Trim then save in chrome.storage.local the content of the note for a paper.
 * Also updates this paper's memory table display and the main popup's textarea
 * (if the paper being edited from the memory is actually the one currently opened
 * and which is therefore being displayed by the popup)
 * @param {string} id The id of the paper whose note is being saved
 * @param {string} note The content of the note
 */
const saveNote = (id, note) => {
    note = $.trim(note);
    _state.papers[id].note = note;
    chrome.storage.local.set({ papers: _state.papers }, () => {
        console.log("Updated the note for " + _state.papers[id].title);

        setHTMLEl(
            findEl(id, "memory-note-div"),
            note
                ? /*html*/ `
                <div class="memory-note-div memory-item-faded">
                    <span class="note-content-header">Note:</span>
                    <span class="note-content">${note}</span>
                </div>`
                : /*html*/ `<div class="memory-note-div memory-item-faded"></div>`
        );
        const textarea = document.getElementById(`popup-form-note-textarea--${id}`);
        val(textarea, note);
        val(findEl(id, "form-note-textarea"), note);
    });
};

/**
 * Trim then save in chrome.storage.local the code link for a paper.
 * Also updates this paper's memory table display and the main popup's code input
 * (if the paper being edited from the memory is actually the one currently opened
 * and which is therefore being displayed by the popup)
 * @param {string} id The id of the paper whose code is being saved
 * @param {string} codeLink The link to the paper's code
 */
const saveCodeLink = (id, codeLink) => {
    codeLink = $.trim(codeLink);
    _state.papers[id].codeLink = codeLink;
    chrome.storage.local.set({ papers: _state.papers }, () => {
        console.log(`Updated the code for ${_state.papers[id].title} to ${codeLink}`);
        setHTMLEl(findEl(id, "memory-item-code-link"), codeLink);
        setHTMLEl(`popup-code-link`, codeLink);
        val(findEl(id, "form-code-input"), codeLink);
        codeLink ? showId("popup-code-link") : hideId("popup-code-link");
        const codeInput = document.getElementById(`popup-form-note-codeLink--${id}`);
        val(codeInput, note);
    });
};

const saveFavoriteItem = (id, favorite) => {
    _state.papers[id].favorite = favorite;
    _state.papers[id].favoriteDate = new Date().toJSON();
    chrome.storage.local.set({ papers: _state.papers }, () => {
        console.log(`${_state.papers[id].title} is favorite: ${favorite}`);
        if (favorite) {
            addClass(`memory-item-container--${id}`, "favorite");
            addClass(
                findEl(id, "memory-item-favorite").querySelector("svg"),
                "favorite"
            );
        } else {
            removeClass(`memory-item-container--${id}`, "favorite");
            removeClass(
                findEl(id, "memory-item-favorite").querySelector("svg"),
                "favorite"
            );
        }

        if (_state.sortKey === "favoriteDate") {
            if (!favorite) {
                sortMemory();
                displayMemoryTable();
            }
            const n = _state.sortedPapers.filter((p) => p.favorite).length;
            const memSearch = document.getElementById("memory-search");
            if (memSearch) {
                setPlaceholder(memSearch, `Search ${n} entries`);
            }
        }

        let checkFavorite = document.getElementById(`checkFavorite--${id}`);
        if (checkFavorite) {
            checkFavorite.checked = favorite;
        }
    });
};

/**
 * Function to change the html content of #memory-sort-arrow to an up or down arrow
 * @param {string} direction up/down string to change the arrow's direction
 */
const setMemorySortArrow = (direction) => {
    let arrow;
    if (direction === "up") {
        arrow = /*html*/ `<svg class="memory-sort-arrow-svg" id="memory-sort-arrow-up">
                    <use xlink:href="../../icons/tabler-sprite-nostroke.svg#tabler-arrow-narrow-up" />
                </svg>`;
    } else {
        arrow = /*html*/ `<svg class="memory-sort-arrow-svg" id="memory-sort-arrow-down">
                    <use xlink:href="../../icons/tabler-sprite-nostroke.svg#tabler-arrow-narrow-down" />
                </svg>`;
    }

    setHTMLEl("memory-sort-arrow", arrow);
};

/**
 * Function to produce the sorting order of papers: it compares 2 papers and
 * returns -1 or 1 depending on which should come first.
 * addDate count and lastOpenDate are sorted descending by default.
 * Others (id, title) are sorted ascending by default.
 * @param {object} paper1 First item in the comparison
 * @param {object} paper2 Second item to compare
 * @returns {number} 1 or -1 depending on the prevalence of paper1/paper2
 */
const orderPapers = (paper1, paper2) => {
    let val1 = paper1[_state.sortKey];
    let val2 = paper2[_state.sortKey];

    if (typeof val1 === "undefined") {
        val1 = "";
    }
    if (typeof val2 === "undefined") {
        val2 = "";
    }

    if (typeof val1 === "string") {
        val1 = val1.toLowerCase();
        val2 = val2.toLowerCase();
    }
    if (_descendingSortKeys.indexOf(_state.sortKey) >= 0) {
        return val1 > val2 ? -1 : 1;
    }
    return val1 > val2 ? 1 : -1;
};

/**
 * Execute the sort operation on _state.sortedPapers using orderPapers, removing the
 * __dataVersion element in _state.papers.
 */
const sortMemory = () => {
    _state.sortedPapers = Object.values(cleanPapers(_state.papers));
    _state.sortedPapers.sort(orderPapers);
    _state.papersList.sort(orderPapers);
};

/**
 * Reverses the _state's 2 ordered lists: sortedPapers and papersList
 */
const reverseMemory = () => {
    _state.sortedPapers.reverse();
    _state.papersList.reverse();
};

/**
 * Function to filter the sortedPapers list into papersList, keeping papers whose
 * title, author or note includes all the words in the query.
 * e.g.: "cli ga" will look for all papers for which either their note, authors or title
 *        contains both the strings "cli" and "ga".
 * @param {string} letters The user's string query.
 */
const filterMemoryByString = (letters) => {
    const words = letters.split(" ");
    let papersList = [];
    for (const paper of _state.sortedPapers) {
        const title = paper.title.toLowerCase();
        const author = paper.author.toLowerCase();
        const note = paper.note.toLowerCase();
        const displayId = paper.id.split("-")[0].toLowerCase();
        if (
            words.every(
                (w) =>
                    title.includes(w) ||
                    author.includes(w) ||
                    note.includes(w) ||
                    displayId.includes(w)
            )
        ) {
            if (!_state.showFavorites || paper.favorite) {
                papersList.push(paper);
            }
        }
    }
    _state.papersList = papersList;
};

/**
 * Filters the sortedPapers into papersList, keeping papers whose tags match the query: all
 * papers whose tags contain all words in the query. Triggered when a query starts with "t: ".
 * e.g.: "cli ga" will look for all papers which have at least 1 tag containing the substring "cli"
 *        AND at least 1 tag containing the substring "ga"
 * @param {string} letters The string representing the tags query, deleting "t:" and splitting on " "
 */
const filterMemoryByTags = (letters) => {
    const tags = letters.replace("t:", "").toLowerCase().split(" ");
    let papersList = [];
    for (const paper of _state.sortedPapers) {
        const paperTags = paper.tags.map((t) => t.toLowerCase());
        if (tags.every((t) => paperTags.some((pt) => pt.indexOf(t) >= 0))) {
            if (!_state.showFavorites || paper.favorite) {
                papersList.push(paper);
            }
        }
    }
    _state.papersList = papersList;
};

/**
 * Filters the sortedPapers into papersList, keeping papers whose code matches the query. Similar
 * to filterMemoryByString but looks into the codeLink attribute. Triggered when a query starts with "c: ".
 * @param {string} letters The string representing the code query, deleting "c:" and splitting on " "
 */
const filterMemoryByCode = (letters) => {
    const words = letters.replace("c:", "").toLowerCase().split(" ");
    let papersList = [];
    for (const paper of _state.sortedPapers) {
        let paperCode = paper.codeLink || "";
        paperCode = paperCode.toLowerCase();
        if (words.every((w) => paperCode.includes(w))) {
            if (!_state.showFavorites || paper.favorite) {
                papersList.push(paper);
            }
        }
    }
    _state.papersList = papersList;
};

/**
 * Updates a paper's tag HTML list from the object's tags array.
 * @param {string} id The paper's id
 */
const updatePaperTagsHTML = (id) => {
    setHTMLEl(
        findEl(id, "tag-list"),
        _state.papers[id].tags
            .map((t) => `<span class="memory-tag">${t}</span>`)
            .join("")
    );
};

/**
 * Update the select2 input for tags, with options from the paper's tags array attribute,
 * using getTagsHTMLOptions.
 * @param {string} id The paper's id
 */
const updateTagOptions = (id) => {
    const tagOptions = getTagsHTMLOptions(_state.papers[id]);
    console.log("tagOptions: ", tagOptions);
    setHTMLEl(findEl(id, "memory-item-tags"), tagOptions);
    setHTMLEl(`popup-item-tags--${id}`, tagOptions);
};

/**
 * Update a paper's tags array attribute from the user's selection in a select2 multi-select input.
 * @param {string} id The paper's id
 * @param {string} elementId The paper's html element selector (either an id for the popup main tags, or a class for a memory item)
 */
const updatePaperTags = (id, elementId) => {
    let ref;
    // elementId may be an ID selector (in the main popup)
    // or a class selector (in the memory)
    if (elementId.startsWith("#")) {
        ref = document.getElementById(elementId.replace("#", ""));
    } else {
        ref = findEl(id, elementId);
    }
    // Store :selected <options> in the tags array
    let tags = Array.from(ref.selectedOptions, (e) => $.trim(e.value)).filter((e) => e);

    // sort tags alphabetically to compare with the existing array of tags
    // for this paper
    tags.sort();
    updated = false;
    if (!arraysIdentical(_state.papers[id].tags, tags)) updated = true;
    _state.papers[id].tags = tags;

    console.log("Update tags to: " + tags.join(", "));

    // If there's a change: update the global set of tags:
    // we need to add or remove tags to the global suggestions array
    // for select2
    if (updated) {
        chrome.storage.local.set({ papers: _state.papers }, () => {
            // update the selected tags in the select2 input for this paper
            updateTagOptions(id);
            // update the displayed tags for this paper
            updatePaperTagsHTML(id);
            // update the global set of tags
            makeTags();
        });
    }
};

/**
 * Create the set of all tags used in papers. If a tag used for a paper is new,
 * it is added to this list, if a tag is never used after it's deleted from its
 * last paper, it is removed from the list.
 */
const makeTags = () => {
    let tags = new Set();
    for (const p of _state.sortedPapers) {
        for (const t of p.tags) {
            tags.add(t);
        }
    }
    _state.paperTags = Array.from(tags);
    _state.paperTags.sort();
};

/**
 * Iterates over all papers in the papersList (sorted and filtered),
 * creates each paper's HTML template and appends it to #memory-table.
 * Also creates the relevant events.
 */
const displayMemoryTable = () => {
    const start = Date.now();

    // Clear existing items
    var memoryTable = document.getElementById("memory-table");
    memoryTable.innerHTML = "";
    // Add relevant sorted papers (papersList may be smaller than sortedPapers
    // depending on the search query)
    let table = [];
    for (const paper of _state.papersList) {
        try {
            table.push(getMemoryItemHTML(paper));
        } catch (error) {
            console.log(error);
            console.log(paper);
        }
    }
    // https://stackoverflow.com/questions/18393981/append-vs-html-vs-innerhtml-performance
    memoryTable.innerHTML = table.join("");

    const end = Date.now();

    console.log("[displayMemoryTable] Rendering duration (s): " + (end - start) / 1000);

    // after a click on such a button, the focus returns to the
    // container to navigate with tab
    addEventToClass(".back-to-focus", "click", handleBackToFocus);
    // delete memory item
    addEventToClass(".delete-memory-item", "click", handleDeleteItem);
    // Open paper page
    addEventToClass(".memory-item-link", "click", handleOpenItemLink);
    // Open code page
    addEventToClass(".memory-item-code-link", "click", handleOpenItemCodeLink);
    // Copy markdown link
    addEventToClass(".memory-item-md", "click", handleCopyMarkdownLink);
    // Copy bibtex citation
    addEventToClass(".memory-item-bibtext", "click", handleCopyBibtex);
    // Copy pdf link
    addEventToClass(".memory-item-copy-link", "click", handleCopyPDFLink);
    // Add to favorites
    addEventToClass(".memory-item-favorite", "click", handleAddItemToFavorites);
    // Cancel edits: bring previous values from _state back
    addEventToClass(".cancel-note-form", "click", handleCancelPaperEdit);
    // When clicking on the edit button, either open or close the edit form
    addEventToClass(".memory-item-edit", "click", handleTogglePaperEdit);

    // Put cursor at the end of the textarea's text on focus
    // (default puts the cursor at the beginning of the text)
    addEventToClass(".form-note-textarea", "focus", handleTextareaFocus);
    // Save fields on edits save (submit)
    addEventToClass(".form-note", "submit", handleEditPaperFormSubmit);
    const end2 = Date.now();

    console.log("[displayMemoryTable] Listeners duration (s): " + (end2 - end) / 1000);
};

const openMemory = () => {
    _state.menuIsOpen && closeMenu();
    _state.memoryIsOpen = true;
    $("#memory-container").slideDown({
        duration: 250,
        easing: "easeOutQuint",
        complete: () => {
            setTimeout(() => {
                document
                    .getElementById("memory-search")
                    .dispatchEvent(new Event("focus"));
            }, 100);
        },
    });
    // hide menu button
    $("#tabler-menu").fadeOut(200);
    // set default sort to lastOpenDate
    val("memory-select", "lastOpenDate");
    // set default sort direction arrow down
    setMemorySortArrow("down");

    // remove ArxivMemory button and show the (x) to close it
    $("#memory-switch-text-on").fadeOut(200, () => {
        $("#memory-switch-text-off").fadeIn(200);
    });
};

/**
 * Main function called after the user clicks on the ArxivMemory button
 * or presses `a`.
 * + closes the menu if it is open (should not be)
 */
const makeMemoryHTML = async () => {
    const tstart = Date.now() / 1000;
    // Fill-in input placeholder
    setPlaceholder("memory-search", `Search ${_state.papersList.length} entries ...`);

    const tdisplay = Date.now() / 1000;

    displayMemoryTable();

    // add input search delay if there are many papers:
    // wait for some time between keystrokes before firing the search
    if (_state.papersList.length < 20) {
        delayTime = 0;
    } else if (_state.papersList.length < 50) {
        delayTime = 300;
    }

    const tevents = Date.now() / 1000;
    console.log("Time to display table (s):" + (tevents - tdisplay));

    // search keypress events.
    // deprecated fix: https://stackoverflow.com/questions/49278648/alternative-for-events-deprecated-keyboardevent-which-property
    addListener(
        "memory-search",
        "keypress",
        delay(handleMemorySearchKeyPress, delayTime)
    );
    addListener("memory-search", "keyup", handleMemorySearchKeyUp);

    addListener("filter-favorites", "click", handleFilterFavorites);
    // listen to sorting feature change
    addListener("memory-select", "change", handleMemorySelectChange);
    // listen to sorting direction change
    addListener("memory-sort-arrow", "click", handleMemorySortArrow);
    const tend = Date.now() / 1000;
    console.log("Time to add events listeners (s):" + (tend - tevents));
    console.log("Total time to make (async) (s):" + (tend - tstart));
};

/**
 * Closes the memory overlay with slideUp
 */
const closeMemory = () => {
    $("#memory-container").slideUp({
        duration: 300,
        easing: "easeOutQuint",
    });
    $("#memory-switch-text-off").fadeOut(200, () => {
        $("#memory-switch-text-on").fadeIn();
    });
    $("#tabler-menu").fadeIn(200);
    val("memory-search", "");
    _state.memoryIsOpen = false;
};
