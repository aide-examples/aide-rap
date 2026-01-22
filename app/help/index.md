# AIDE IRMA – User Guide

**Intelligent Repair and Maintenance in Aviation**

---

## Overview

IRMA is a demonstration application for managing aircraft fleet data, operators, and maintenance records. It showcases the capabilities of the AIDE rapid application development framework.

---

## Navigation

### Header
- **App name**: Click to return to home
- **Menu bar**: Quick access to common functions

### Entity Explorer (Left Panel)
- **Entity selector**: Dropdown to choose data type (Aircraft, Operator, etc.)
- **View modes**: Switch between Table, Tree (vertical), or Tree (horizontal)
- **Filter**: Search within current entity
- **New button**: Create a new record

### Detail Panel (Right Panel)
- **Collapsed**: Click the expand button on the right edge
- **View mode**: Shows record details (read-only)
- **Edit mode**: Form for modifying records

---

## Working with Data

### Viewing Records

1. Select an entity type from the dropdown (e.g., "Aircraft")
2. Records appear in the main view
3. Click a record to select it
4. Right-click for context menu → **Details** to view in side panel

### Creating Records

1. Click the **New** button
2. Fill in the form fields (required fields marked with *)
3. For foreign keys: Select from dropdown or search
4. Click **Save**

### Editing Records

1. Right-click a record → **Edit**
2. Modify fields as needed
3. Click **Save** to apply changes

### Deleting Records

1. Right-click a record → **Delete**
2. Confirm the deletion
3. Note: Records referenced by other data cannot be deleted

---

## Tree View Features

### Expanding Relationships

- Click the **▶** triangle next to a foreign key to expand it
- Continue expanding to explore deeper relationships
- **Back-references** show which records point to the current one

### Cycle Detection

When navigating relationships, you may encounter cycles (e.g., Aircraft → Type → Aircraft). These are marked with **↻** to prevent infinite loops.

### Focused Navigation

Opening a new branch automatically closes other expanded branches, keeping the view manageable.

---

## Data Types

### Areas of Competence

Entities are grouped by colored areas:
- Each area represents a domain (Fleet, Technical, Maintenance, etc.)
- Colors appear in the entity selector and throughout the UI

### Validation

- **Required fields**: Must be filled before saving
- **Pattern validation**: Some fields require specific formats (e.g., aircraft registration)
- **Enum fields**: Choose from predefined values
- **Foreign keys**: Must reference existing records

---

## Tips & Shortcuts

- **Right-click**: Opens context menu on any record
- **Escape**: Closes context menu or dialog
- **Filter**: Type to search across label fields
- **Session persistence**: View preferences are remembered

---

## About

IRMA is built with the [AIDE Framework](/about) – a rapid application development platform that generates applications from Markdown-based data models.

For technical documentation, see the [Framework Guide](/about).
