var paperTitles = {};
var updates = {};

const knownPageHasUrl = (url) => {
    const pdfPages = Object.values(global.knownPaperPages).map((v) => v.reverse()[0]);
    return pdfPages.some((p) => url.includes(p));
};

const isPdf = (url) => {
    return url.endsWith(".pdf") || url.includes("openreview.net/pdf");
};

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type == "update-title") {
        console.log("Background message options:");
        console.log({ options: request.options });
        const { title, url } = request.options;
        paperTitles[url] = title.replaceAll('"', "'");
    }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const paperTitle = paperTitles[tab.url];
    if (!updates.hasOwnProperty(tabId)) updates[tabId] = 0;
    if (updates[tabId] > 9) {
        if (updates[tabId] == 10) {
            console.log(
                "WARNING: max number of title updates reached. This is a logic failure in ArxivTools. Please open an issue at https://github.com/vict0rsch/ArxivTools"
            );
            updates[tabId] += 1;
        }
        return; // in case of logic failure on different browsers, prevent infinite loop
    }
    if (
        paperTitle && // title from content_script message is set
        changeInfo.title && // change is about title
        !knownPageHasUrl(changeInfo.title) && // ignore event triggered by `document.title=''` which sets title to url
        changeInfo.title !== paperTitle && // there is a new title
        isPdf(tab.url) // only valid for pdfs
    ) {
        // console.log(">>>>> onUpdated: tabId, changeInfo, tab, paperTiles");
        // console.log(tabId);
        // console.log(changeInfo);
        // console.log(tab);
        // console.log(paperTitles);
        console.log(`Updating pdf file name to "${paperTitle}"`);
        // console.log("<<<<<<<<<<<");

        // https://stackoverflow.com/questions/69406482/window-title-is-not-changed-after-pdf-is-loaded
        chrome.tabs.executeScript(tabId, {
            code: `document.title=''; document.title="${paperTitle}"`,
            runAt: "document_start",
        });
        updates[tabId] += 1;
    }
});
