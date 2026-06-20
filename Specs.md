About The Project 

This project is indiamart chrome extension which load the leads data on some interval and filter out the lead using some filter criteria given by the user and buys the leads which matches the criteria's

Tech Stack 
 - Framework: React.
 - Language: TypeScript.
 - Styling: Tailwind CSS or Shadcn/ui.
 - Build Tool/Bundler: Vite + @crxjs/vite-plugin.

UI should contain 
- Time interval input - ( Frequency in which the API request happens )
- Start Button - ( to start the cycle )
- Stop Button - ( to stop the cycle )
- Status Indicator

Flow 
 - Once the user clicks Start
 - The timer should stop
 - Once the timer ends , It should check for `glusrid` in localstorage , If it's there go ahead call the leading loading API
 - Do it after every time interval , unless the user clicks the stop button
 - This process should never stop (Even when the user switches the tab , Even when the minimise the chrome application )
 
 - If the `glusrid` is not available in the localstorage 
 - go to `https://seller.indiamart.com/bltxn/?pref=relevant` page and reload the page
 - The API with url `https://seller.indiamart.com/blreact/getBLDisplayData` happen in that page from than API call u can find the `glusrid` in `BINDED` key value of the API reponse , extract it and save it in the localstorage , so on the next run's this flow never get's executed
 - See  [Lead Lodding API response ](lead_loading_api_response.json) for more clarity


## 1. Lead loading API (primary)

### Endpoint

- **URL:** `POST https://seller.indiamart.com/blreact/getBLDisplayData`
- **Content-Type:** `application/json`
- **Auth headers in HAR:** none (`Authorization` absent; `Cookie` header absent — see Session section)
- **Other headers:** standard browser CORS headers (`Origin`, `Referer: https://seller.indiamart.com/bltxn/?pref=recent`, `User-Agent`)

### Request payload (from HAR)

```json
{
  "LocPref": "4",
  "stateid": "",
  "city": "",
  "iso": "",
  "pref_city_lead": 0,
  "glusrid": "56238099",
  "inbox": "",
  "offer": "",
  "offer_type": "B",
  "start": 1,
  "end": 20,
  "UsageTyp": "",
  "quantity": "",
  "is_email": "",
  "is_gst": "",
  "is_catalog": "",
  "is_mobnum": "",
  "is_busname": "",
  "mcatid": "",
  "sov": "",
  "eov": null,
  "enqType": ""
}
```

**Parameter notes:**


| Field                                                         | Value in capture  | Purpose                                            |
| ------------------------------------------------------------- | ----------------- | -------------------------------------------------- |
| `glusrid`                                                     | Seller GL user ID | Identifies logged-in seller                        |
| `offer_type`                                                  | `"B"`             | Buy-leads tab (vs other offer types)               |
| `LocPref`                                                     | `"4"`             | Location filter; response echoes `LocPref: "CITY"` |
| `start` / `end`                                               | `1` / `20`        | Pagination (20 leads per page)                     |
| `mcatid`, `city`, `stateid`, `iso`                            | empty             | Category/location filters (optional)               |
| `sov`, `eov`                                                  | empty / null      | Order-value filters (optional)                     |
| `is_email`, `is_gst`, `is_catalog`, `is_mobnum`, `is_busname` | empty             | Buyer verification filters                         |


### Response structure (HTTP 200)

Top-level keys:

`Allcount`, `BLflag`, `BLmsg`, `CODE`, `Categories`, `CategoryName`, `DisplayList`, `Lead_Count`, `LocPref`, `Msg`, `MESSAGE`, `STATUS`, `TotalBuylead`, `StateWiseCount`, `cities`, `countries`, `unique_id`, …

**Success indicators:** `CODE: "200"`, `BLflag: "1"`, `STATUS: "Success"`, `Msg: "Success"`

**Summary counts in this capture:**

- `Allcount`: `"186"` (total matching leads)
- `Lead_Count`: `20` (returned in this page)
- `TotalBuylead`: `179`

### Lead array: `DisplayList`

Each lead object contains **90+ fields**. Key fields for filtering and purchase mapping:


| Filter / use case         | JSON field                                    | Example (lead #1)                      |
| ------------------------- | --------------------------------------------- | -------------------------------------- |
| **Lead ID (purchase)**    | `ETO_OFR_ID`                                  | `146298055895`                         |
| Alt display ID            | `BLCARDDATA[0].FK_ETO_OFR_DISPLAY_ID`         | `146298055895`                         |
| **Title**                 | `ETO_OFR_TITLE`                               | `"Kids Unicorn Polyester Trolley Bag"` |
| **Credit cost ("price")** | `ETO_CREDITS`                                 | `200`                                  |
| **City**                  | `GLUSR_CITY`                                  | `"Bengaluru"`                          |
| **State**                 | `GLUSR_STATE`                                 | `"Karnataka"`                          |
| **Country**               | `GLUSR_COUNTRY`                               | `"India"`                              |
| **Category ID**           | `FK_GLCAT_MCAT_ID`                            | `96454`                                |
| **Category name**         | `ETO_OFR_GLCAT_MCAT_NAME` / `PRIME_MCAT_NAME` | `"Kids School Bag"`                    |
| **Order value**           | `ETO_OFR_APPROX_ORDER_VALUE`                  | `"Above 3,000"`                        |
| **Quantity**              | `ETO_OFR_QTY`                                 | (may be blank)                         |
| **Purchase state**        | `PURCHASE_STATUS`                             | `"OPEN"`                               |
| **Grid metadata**         | `GRID_PARAMETERS`                             | `"1#3 3#1#BA#4"`                       |
| Verified buyer flags      | `ETO_OFR_VERIFIED`, `ETO_OFR_EMAIL_VERIFIED`  | various ints                           |
| Attachments               | `ATTACHMENT`, `IS_ATTACHMENT`                 | image URLs                             |


**Sample first 5 leads (credits were all 200 in this page):**

1. Bengaluru / Kids School Bag / Above 3,000
2. Kochi / Diaper Bags / Above 1,000
3. Pudukkottai / Bags
4. Kolar / College Bag
5. Virudhunagar / School Bags

**Category facet object:** `Categories` maps mcat ID → `[count, name, type]` e.g. `"96454": ["1", "Kids School Bag", "B"]`

---
