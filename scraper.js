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

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: "new" });
  console.log("Browser launched.");
  const page = await browser.newPage();
  console.log("New page created.");

  const allResults = [];

  for (const slug of categorySlugs) {
    
    for (let pageNum = 1; pageNum <= 100; pageNum++) {
      const url = `${BASE_URL}/${slug}?perPage=1000&page=${pageNum}`;
      console.log(`Going to category: ${slug}, Page: ${pageNum} => ${url}`);
      
      try {
        await page.goto(url, { waitUntil: "networkidle2", timeout: 120000 });
        console.log(`Waiting 15 seconds for page ${pageNum} to load...`);

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

        const pageResults = [];
        for (const link of productLinks) {
          console.log(`Scraping product: ${link}`);
          const productPage = await browser.newPage();
          try {
            await productPage.goto(link, { waitUntil: "networkidle2", timeout: 90000 });
            
            const details = await productPage.evaluate(() => {
              const title = document.querySelector("h1")?.innerText?.trim() || "";
              
              let price = document.querySelector("span.text-2xl.font-bold.text-gray-900")?.innerText?.trim() || "";
              if (!price) {
                  const priceElement = [...document.querySelectorAll("div, span")].find(el => el.innerText.includes("Цена:"));
                  price = priceElement?.innerText.replace("Цена:", "").trim() || "";
              }

              let sku = "";
              const skuLabel = [...document.querySelectorAll("div, span, td")].find(el => el.innerText.includes("Код на продукта"));
              if (skuLabel) {
                  sku = skuLabel.nextElementSibling?.innerText?.trim() || skuLabel.parentElement?.innerText?.replace("Код на продукта", "").trim() || "";
              }

              let description = "";
              const descLabel = [...document.querySelectorAll("div, span, h2, h3")].find(el => el.innerText.includes("Описание"));
              if (descLabel) {
                  description = descLabel.nextElementSibling?.innerText?.trim() || descLabel.parentElement?.innerText?.replace("Описание", "").trim() || "";
              }

              return { title, price, sku, description };
            });

            const record = { category: slug, page: pageNum, ...details, href: link };
            pageResults.push(record);
            allResults.push(record);
            console.log(`Successfully scraped: ${details.title}`);
          } catch (err) {
            console.error(`Failed to scrape ${link}: ${err.message}`);
          } finally {
            await productPage.close();
          }
        }

        if (pageResults.length > 0) {
            const csvWriter = createObjectCsvWriter({
                path: "scraped-products.csv",
                header: [
                    { id: "category", title: "Category" },
                    { id: "page", title: "Page" },
                    { id: "title", title: "Title" },
                    { id: "price", title: "Price" },
                    { id: "sku", title: "SKU" },
                    { id: "description", title: "Description" },
                    { id: "href", title: "Link" },
                ],
                append: fs.existsSync("scraped-products.csv"),
            });

            await csvWriter.writeRecords(pageResults);
            console.log(`Saved results from page ${pageNum} to CSV.`);
        }

      } catch (err) {
        console.error(`Failed to load page ${pageNum} for ${slug}: ${err.message}`);
      }
    }
  }

  console.log(`Scraping complete. Total products scraped: ${allResults.length}`);
  await browser.close();
})();