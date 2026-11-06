# CargoVerity — Synthetic Sample Data Manifest

## 1. Provenance and Privacy Notice

> [!IMPORTANT]
> **SYNTHETIC DEMO DOCUMENTS — NOT FOR CUSTOMS FILING**
> All files in `public/sample-docs/` and all test fixtures are strictly synthetic demonstrations created for testing CargoVerity's AI extraction and deterministic cross-check engine.
> None of the names, addresses, tax IDs, container numbers, or contact details belong to actual individuals or real proprietary transactions.
> Real client documents and personal data are strictly out of scope.

Every page of every generated sample document contains a bold red watermark and security banner:
`*** SYNTHETIC DEMO DOCUMENT — NOT FOR CUSTOMS FILING ***`

---

## 2. Source Values from Brief 5

The project brief provided the following base values:

| Shipment | Document | Supplier | Item | Quantity | Unit Price | Gross Weight |
|---|---|---|---|---:|---:|---:|
| **SHP-24811** | Commercial Invoice | Company B (China) | LED panel light 40W | 2,400 pcs | USD 6.80 | **3,120 kg** |
| **SHP-24811** | Packing List | Company B (China) | LED panel light 40W | 2,400 pcs | *Not supplied* | **3,165 kg** |
| **SHP-24812** | Commercial Invoice | Company C (Sweden) | Steel ball valve DN50 | 180 units | EUR 42.50 | **1,460 kg** |

### Verified Brief Facts:
1. **The 45 kg Discrepancy:** In `SHP-24811`, the invoice gross weight (3,120 kg) and packing list gross weight (3,165 kg) differ by exactly **45 kg**.
2. **Unexplained Cause:** The source documents provide **no explanation** for this 45 kg difference. CargoVerity highlights the mathematical discrepancy to reviewers but **never invents or assumes an unverified cause**.
3. **No Original BL Data:** The brief provided no Bill of Lading row for either shipment. Synthetic BL data is added strictly to demonstrate three-way cross-checks.

---

## 3. Scenarios and Invented Values

### Scenario 1: `SHP-24811` — The 45 kg Weight Discrepancy
- **Purpose:** Exercises the deterministic cross-check rule between Commercial Invoice and Packing List, detecting the 45 kg gross weight difference without fabricating an explanation.
- **Files:**
  - `public/sample-docs/shp-24811-invoice.pdf`
  - `public/sample-docs/shp-24811-packing-list.pdf`
  - `public/sample-docs/shp-24811-bill-of-lading.pdf`
- **Source Values:**
  - Exporter: Company B (China)
  - Item: LED panel light 40W, 2,400 pcs @ USD 6.80 = USD 16,320.00
  - Invoice Gross Weight: 3,120 kg
  - Packing List Gross Weight: 3,165 kg
- **Invented Values:**
  - Importer / Consignee: `Acme Logistics India Pvt Ltd`
  - Document Numbers: `INV-24811`, `PL-24811`, `MSKU-24811-BL`
  - Dates: `2026-10-15`, `2026-10-16`, `2026-10-18`
  - Packages: `120 cartons` (20 units/carton)
  - Net Weight: `2,880 kg`
  - HSN Code: `9405.10`
  - Ports: Loading `Shanghai, China` / Discharge `Nhava Sheva, India`
  - Container / Vessel: `MSKU-982144-0` / `EVER GIVEN V.042W`
  - BL Gross Weight: `3,165 kg` (matches PL, exposing the invoice mismatch in 3-way check)

---

### Scenario 2: `SHP-24812` — European Valve Shipment
- **Purpose:** Exercises Euro currency handling, different package units (wooden crates), and metric weights.
- **Files:**
  - `public/sample-docs/shp-24812-invoice.pdf`
  - `public/sample-docs/shp-24812-packing-list.pdf`
  - `public/sample-docs/shp-24812-bill-of-lading.pdf`
- **Source Values:**
  - Exporter: Company C (Sweden)
  - Item: Steel ball valve DN50, 180 units @ EUR 42.50 = EUR 7,650.00
  - Invoice Gross Weight: 1,460 kg
- **Invented Values:**
  - Importer: `Nordic Valves India Corp`
  - Document Numbers: `INV-24812`, `PL-24812`, `HLCU-24812-SE`
  - Dates: `2026-10-20`, `2026-10-21`, `2026-10-23`
  - Packages: `15 wooden crates`
  - Net Weight: `1,350 kg`
  - HSN Code: `8481.80`
  - Container / Vessel: `HLCU-765432-1` / `MSC OSCAR V.201E`
  - PL & BL Gross Weight: `1,460 kg` (consistent across all three documents)

---

### Scenario 3: `SHP-24813` — Internally Consistent Happy Path
- **Purpose:** End-to-end green path. All values across Invoice, Packing List, and Bill of Lading match perfectly. Used to demonstrate manager approval and guarded CSV export.
- **Files:**
  - `public/sample-docs/shp-24813-invoice.pdf`
  - `public/sample-docs/shp-24813-packing-list.pdf`
  - `public/sample-docs/shp-24813-bill-of-lading.pdf`
- **Invented Values:**
  - Exporter: `SolarTech Global GmbH (Germany)`
  - Importer: `Bharat Renewable Energy Ltd`
  - Document Numbers: `INV-24813`, `PL-24813`, `CMAU-24813-DE`
  - Dates: `2026-10-25`, `2026-10-26`, `2026-10-27`
  - Item: `Solar Inverter 5kW Grid-Tie`, 50 units @ USD 850.00 = USD 42,500.00
  - Total Invoice: `USD 42,500.00`
  - Packages: `50 boxes`
  - Gross Weight: `1,250 kg` (matches CI, PL, BL)
  - Net Weight: `1,150 kg`
  - HSN Code: `8504.40`
  - Container: `CMAU-128490-2` / Vessel: `CMA CGM ANTOINE V.881S`

---

### Scenario 4: `SHP-24814` — Low-Confidence Scenario
- **Purpose:** Exercises the confidence review policy. Features overlapping text and degraded visual contrast to test confidence flagging (< 0.85) requiring manual reviewer confirmation.
- **Files:**
  - `public/sample-docs/shp-24814-invoice.pdf`
  - `public/sample-docs/shp-24814-packing-list.pdf`
  - `public/sample-docs/shp-24814-bill-of-lading.pdf`
- **Invented Values:**
  - Exporter: `Delta Sensors Pte Ltd (Singapore)`
  - Importer: `Hind Automation Systems`
  - Document Numbers: `INV-24814-UNCERT`, `PL-24814`, `ONEY-24814-SG`
  - Item: `Pressure Transmitter 4-20mA`, 100 units @ USD 185.00 = USD 18,500.00
  - Gross Weight: `420 kg` / Net Weight: `380 kg`
  - Packages: `20 cartons`

---

### Scenario 5: `SHP-24815` — Unreadable Scan / Fallback Scenario
- **Purpose:** Simulates severely degraded scan quality with cross-hatching and noise. Triggers the unreadable document state (`manualEntryRequired: true`), exercising the manual-entry fallback workflow.
- **Files:**
  - `public/sample-docs/shp-24815-invoice.pdf`
  - `public/sample-docs/shp-24815-packing-list.pdf`
  - `public/sample-docs/shp-24815-bill-of-lading.pdf`
- **Invented Values:**
  - Exporter: `Apex Industrial Supplies (Malaysia)`
  - Importer: `Western Power Equipments`
  - Document Numbers: `INV-24815-DEGRADED`, `PL-24815`, `APLU-24815-MY`
  - Item: `Circuit Breaker High Voltage 11kV`, 10 units @ USD 920.00 = USD 9,200.00
  - Gross Weight: `650 kg` / Net Weight: `590 kg`
  - Packages: `30 crates`

---

## 4. Generating and Validating Fixtures

To regenerate all 15 synthetic PDFs from source code:

```bash
npm run generate:sample-docs
```

The generation script verifies:
1. Every generated document is a valid, parseable PDF.
2. The watermark `SYNTHETIC DEMO DOCUMENT — NOT FOR CUSTOMS FILING` is embedded on every page.
3. Byte sizes conform to the `MAX_PDF_BYTES` limitation.
4. Page counts conform to `MAX_PDF_PAGES <= 50`.

