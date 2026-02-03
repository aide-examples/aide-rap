# Import & Seed Data Workflows

Each workflow described with block diagrams showing data flow top-to-bottom, inputs from left.

---

## 1. Generate (AI-assisted Record Creation)

```mermaid
flowchart TB
    subgraph input["Input"]
        MD["Entity.md<br/>## Data Generator"]
        DB_FK[("DB: FK Entities")]
    end

    subgraph steps["Process"]
        INSTR["1. Load/Edit Instruction"]
        BUILD["2. Build AI Prompt"]
        COPY["3. Copy to Clipboard"]
        AI["4. AI generates JSON"]
        PASTE["5. Paste Response"]
        PARSE["6. Parse & Validate"]
        REVIEW["7. Review Records"]
        SAVE["8. Save & Load"]
    end

    subgraph output["Output"]
        SEED["seed/*.json"]
        DB[("Database")]
    end

    MD --> INSTR
    INSTR --> BUILD
    DB_FK -->|"FK References<br/>(id + label)"| BUILD
    BUILD --> COPY
    COPY --> AI
    AI --> PASTE
    PASTE --> PARSE
    PARSE --> REVIEW
    REVIEW --> SAVE
    SAVE --> SEED
    SEED --> DB
```

**Prompt contains:**
| Section | Source |
|---------|--------|
| Entity Schema | Columns, types, constraints |
| Type Definitions | Patterns, enums |
| Instruction | `## Data Generator` |
| FK References | All records from referenced entities |
| Back-References | Entities that reference this one |
| Seed Context | `## Seed Context` section |

---

## 2. Complete (AI-assisted Attribute Completion)

```mermaid
flowchart TB
    subgraph input["Input"]
        MD["Entity.md<br/>## Data Completer"]
        DB_REC[("DB: Existing Records")]
        DB_FK[("DB: FK Entities")]
    end

    subgraph steps["Process"]
        INSTR["1. Load/Edit Instruction"]
        BUILD["2. Build AI Prompt"]
        COPY["3. Copy to Clipboard"]
        AI["4. AI completes records"]
        PASTE["5. Paste Response"]
        PARSE["6. Parse & Validate"]
        REVIEW["7. Review Updates"]
        SAVE["8. Save & Load"]
    end

    subgraph output["Output"]
        SEED["seed/*.json"]
        DB[("Database<br/>(UPDATE)")]
    end

    MD --> INSTR
    DB_REC -->|"Records with IDs"| BUILD
    INSTR --> BUILD
    DB_FK -->|"FK References"| BUILD
    BUILD --> COPY
    COPY --> AI
    AI --> PASTE
    PASTE --> PARSE
    PARSE --> REVIEW
    REVIEW --> SAVE
    SAVE --> SEED
    SEED --> DB
```

**Key difference:** Prompt includes existing records with IDs. AI fills NULL values. IDs must stay unchanged for UPDATE.

---

## 3. Import (Manual JSON/CSV Paste)

```mermaid
flowchart TB
    subgraph input["Input"]
        CLIP["Clipboard<br/>(JSON or CSV)"]
        FILE["File Drop<br/>(*.json, *.csv)"]
    end

    subgraph steps["Process"]
        PASTE["1. Paste/Drop Data"]
        DETECT["2. Detect Format"]
        PARSE["3. Parse Records"]
        VALIDATE["4. Validate<br/>(FK, Unique, Types)"]
        PREVIEW["5. Preview + Conflicts"]
        MODE["6. Select Mode<br/>(merge/skip/replace)"]
        SAVE["7. Save & Load"]
    end

    subgraph output["Output"]
        SEED["seed/*.json"]
        DB[("Database")]
    end

    CLIP --> PASTE
    FILE --> PASTE
    PASTE --> DETECT
    DETECT --> PARSE
    PARSE --> VALIDATE
    VALIDATE --> PREVIEW
    PREVIEW --> MODE
    MODE --> SAVE
    SAVE --> SEED
    SEED --> DB
```

---

## 4. Import by Rule (XLSX Conversion)

```mermaid
flowchart TB
    subgraph input["Input"]
        XLSX["XLSX File<br/>(Excel)"]
        RULE["Import Rule<br/>(Column Mapping)"]
    end

    subgraph steps["Process"]
        READ["1. Read XLSX Sheet"]
        FILTER_S["2. Source Filter"]
        DEDUP["3. Deduplicate"]
        TRANSFORM["4. Transform Columns"]
        FILTER_T["5. Target Filter"]
        WRITE["6. Write JSON"]
        PREVIEW["7. Preview Records"]
        MODE["8. Select Mode"]
        LOAD["9. Load to DB"]
    end

    subgraph output["Output"]
        IMP["import/*.json"]
        DB[("Database")]
    end

    XLSX --> READ
    RULE --> TRANSFORM
    READ --> FILTER_S
    FILTER_S --> DEDUP
    DEDUP --> TRANSFORM
    TRANSFORM --> FILTER_T
    FILTER_T --> WRITE
    WRITE --> IMP
    IMP --> PREVIEW
    PREVIEW --> MODE
    MODE --> LOAD
    LOAD --> DB
```

---

## 5. Load Seed

```mermaid
flowchart TB
    subgraph input["Input"]
        SEED["seed/*.json"]
        DB_EXIST[("DB: Existing Data")]
    end

    subgraph steps["Process"]
        READ["1. Read Seed File"]
        VALIDATE["2. Validate Records"]
        RESOLVE["3. Resolve FK Labels → IDs"]
        CONFLICT["4. Detect Conflicts"]
        MODE["5. Select Mode<br/>(merge/skip/replace)"]
        EXEC["6. Execute Load"]
    end

    subgraph output["Output"]
        DB[("Database<br/>INSERT/UPDATE")]
    end

    SEED --> READ
    READ --> VALIDATE
    VALIDATE --> RESOLVE
    DB_EXIST --> CONFLICT
    RESOLVE --> CONFLICT
    CONFLICT --> MODE
    MODE --> EXEC
    EXEC --> DB
```

---

## 6. Backup

```mermaid
flowchart TB
    subgraph input["Input"]
        DB[("Database<br/>(all entities)")]
    end

    subgraph steps["Process"]
        SELECT["1. SELECT * FROM each entity"]
        CONVERT["2. Convert FK IDs → Labels"]
        WRITE["3. Write JSON files"]
    end

    subgraph output["Output"]
        BAK["backup/*.json"]
    end

    DB --> SELECT
    SELECT --> CONVERT
    CONVERT --> WRITE
    WRITE --> BAK
```

---

## 7. Restore

```mermaid
flowchart TB
    subgraph input["Input"]
        BAK["backup/*.json"]
    end

    subgraph steps["Process"]
        READ["1. Read Backup Files"]
        CLEAR["2. DELETE all from DB"]
        RESOLVE["3. Resolve FK Labels → IDs"]
        INSERT["4. INSERT all records"]
    end

    subgraph output["Output"]
        DB[("Database<br/>(restored)")]
    end

    BAK --> READ
    READ --> CLEAR
    CLEAR --> RESOLVE
    RESOLVE --> INSERT
    INSERT --> DB
```

---

## 8. Clear

```mermaid
flowchart TB
    subgraph input["Input"]
        TRIGGER["User Action"]
    end

    subgraph steps["Process"]
        CONFIRM["1. Confirm (Clear All only)"]
        DELETE["2. DELETE FROM entity"]
    end

    subgraph output["Output"]
        DB[("Database<br/>(empty)")]
    end

    TRIGGER --> CONFIRM
    CONFIRM --> DELETE
    DELETE --> DB
```

---

## Load Modes

| Mode | SQL | Use Case |
|------|-----|----------|
| **replace** | `INSERT OR REPLACE` | Overwrite everything |
| **merge** | `UPDATE` + `INSERT` | Add changes (default) |
| **skip_conflicts** | `INSERT` new only | Protect existing |

---

## Validation Pipeline

```mermaid
flowchart LR
    subgraph input["Input"]
        REC["Records"]
    end

    subgraph checks["Checks"]
        FK["FK Label → ID"]
        UNIQ["Unique Keys"]
        TYPE["Type Constraints"]
    end

    subgraph output["Output"]
        VALID["Valid Records"]
        WARN["Warnings"]
        ERR["Errors"]
    end

    REC --> FK
    FK --> UNIQ
    UNIQ --> TYPE
    TYPE --> VALID
    FK -.->|"not found"| WARN
    UNIQ -.->|"conflict"| WARN
    TYPE -.->|"invalid"| ERR
```

---

## Directory Structure

```
app/systems/<system>/data/
├── seed/              ← Versioned seed files
├── import/            ← XLSX conversions (generated)
├── backup/            ← DB snapshots (gitignored)
└── rap.sqlite         ← Database (gitignored)
```
