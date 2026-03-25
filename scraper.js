const puppeteer = require("puppeteer");
const fs = require("fs");
const { createObjectCsvWriter } = require("csv-writer");

const categorySlugs = [
  "zahranvaniya-pdp-platki",
  "elektronni-komponenti-i-baterii",
  "poluprovodnici-i-integralni-shemi",
  "servizno-oborudvane-i-instrumenti",
  "kabeli-i-nakraynici",
  "tv-audio-video",
  "stoyki-za-televizori-i-rezervni-chasti-za-doma",
  "led-podsvetki-i-lenti"
];

// Base URL
const BASE_URL = "https://ksp-electronics.com";

const PROGRESS_FILE = "progress.json";

function saveProgress(categoryIndex, pageNum) {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ categoryIndex, pageNum }));
}

function loadProgress() {
    if (fs.existsSync(PROGRESS_FILE)) {
        return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
    }
    return { categoryIndex: 0, pageNum: 1 };
}

async function writeResultsToCsv(results) {
    if (results.length === 0) return;
    const csvWriter = createObjectCsvWriter({
        path: "scraped-products.csv",
        header: [
            { id: "category", title: "Category" },
            { id: "page", title: "Page" },
            { id: "title", title: "Title" },
            { id: "price", title: "Price" },
            { id: "status", title: "Status" },
            { id: "quantity", title: "Quantity" },
            { id: "description", title: "Description" },
            { id: "sku", title: "SKU" },
            { id: "barcode", title: "Barcode" },
            { id: "brand", title: "Brand" },
            { id: "href", title: "Link" },
        ],
        append: fs.existsSync("scraped-products.csv"),
    });

    await csvWriter.writeRecords(results);
    console.log(`Successfully saved ${results.length} records to CSV.`);
}

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: "new" });
  console.log("Browser launched.");
  const page = await browser.newPage();
  console.log("New page created.");

  const allResults = [];
  let currentPageResults = [];

  // Graceful shutdown handler
  process.on("SIGINT", async () => {
    console.log("\nStopping scraper manually...");
    if (currentPageResults.length > 0) {
        console.log(`Writing ${currentPageResults.length} pending records to CSV...`);
        await writeResultsToCsv(currentPageResults);
    }
    await browser.close();
    console.log("Browser closed. Progress NOT saved for the current unfinished page.");
    process.exit(0);
  });

  const { categoryIndex: startCatIdx, pageNum: startPageNum } = loadProgress();
  console.log(`Resuming from Category Index: ${startCatIdx}, Page: ${startPageNum}`);

  for (let i = startCatIdx; i < categorySlugs.length; i++) {
    const slug = categorySlugs[i];
    const initialPage = (i === startCatIdx) ? startPageNum : 1;
    
    for (let pageNum = initialPage; pageNum <= 100; pageNum++) {
      const url = `${BASE_URL}/${slug}?perPage=10&page=${pageNum}`;
      console.log(`Going to category: ${slug}, Page: ${pageNum} => ${url}`);
      
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
        
        const productLinks = await page.$$eval("a.line-clamp-2, a.items.absolute.inset-0", (links) => {
          return [...new Set(links.map((a) => a.href))].filter(href => {
              return href.split("/").length > 4; 
          });
        });

        if (productLinks.length === 0) {
            console.log(`No more products found on page ${pageNum} for ${slug}. Moving to next category...`);
            break; 
        }

        console.log(`Found ${productLinks.length} product links on page ${pageNum}`);

        currentPageResults = [];
        for (const link of productLinks) {
          console.log(`Scraping product: ${link}`);
          const productPage = await browser.newPage();
          try {
            await productPage.goto(link, { waitUntil: "networkidle2", timeout: 90000 });
            
            const details = await productPage.evaluate(() => {
              const findValueByLabel = (label) => {
                const elements = [...document.querySelectorAll("div, span, td, th, h2, h3, dt, dd, b, strong")];
                const match = elements.find(el => {
                  const text = el.innerText.trim();
                  return text === label || text === label + ":";
                });
                
                if (match) {
                  return match.nextElementSibling?.innerText?.trim() || 
                         match.parentElement?.nextElementSibling?.innerText?.trim() || "";
                }
                return "";
              };

              const title = document.querySelector("h1")?.innerText?.trim() || "";
              
              let price = document.querySelector(".text-2xl.font-bold, .text-primary-600, .price")?.innerText?.trim() || "";
              if (!price || price.includes("\n") || price.length > 50) {
                  const priceLabelValue = findValueByLabel("Цена");
                  if (priceLabelValue) {
                      price = priceLabelValue;
                  } else {
                      const matches = document.body.innerText.match(/(\d+,\d+\s*€)/);
                      price = matches ? matches[1] : "";
                  }
              }
              
              if (price) {
                  const priceMatch = price.match(/(\d+,\d+\s*€)/);
                  if (priceMatch) price = priceMatch[1];
              }

              const status = findValueByLabel("Статус").split("\n")[0].trim();
              const quantity = findValueByLabel("Налично количество").split("\n")[0].trim();
              const description = findValueByLabel("Описание");
              const sku = findValueByLabel("Код на продукта") || title;
              const barcodeRaw = findValueByLabel("Баркод");
              const barcode = barcodeRaw ? `\t${barcodeRaw}` : ""; // Add tab prefix to preserve zeros in Excel
              const brand = findValueByLabel("Марка / Производител");

               return { title, price, sku, description, barcode, brand, status, quantity };
            });

            const record = { category: slug, page: pageNum, ...details, href: link };
            currentPageResults.push(record);
            allResults.push(record);
            console.log(`Successfully scraped: ${details.title}`);
          } catch (err) {
            console.error(`Failed to scrape ${link}: ${err.message}`);
          } finally {
            await productPage.close();
          }
        }

        if (currentPageResults.length > 0) {
            await writeResultsToCsv(currentPageResults);
            saveProgress(i, pageNum + 1); 
            currentPageResults = [];
            console.log(`Saved results from page ${pageNum} and updated progress.`);
        }

      } catch (err) {
        console.error(`Failed to load page ${pageNum} for ${slug}: ${err.message}`);
      }
    }
  }

  console.log(`Scraping complete. Total products scraped: ${allResults.length}`);
  if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  await browser.close();
})();