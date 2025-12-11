# XLSX Reader Tool

## Overview

Read Excel files (.xlsx, .xlsm, .xltx, .xltm) with support for multiple sheets, JSON output, and CSV conversion.

## Features

- Multiple sheet support
- JSON output for programmatic use
- CSV export functionality
- Automatic header detection
- Empty row handling

## Basic Usage

```sh
# Read active sheet
read_xlsx.py data.xlsx

# List all sheets
read_xlsx.py data.xlsx --list-sheets

# Read specific sheet
read_xlsx.py data.xlsx --sheet "Summary"

# Get JSON output
read_xlsx.py data.xlsx --json

# Get all sheets as JSON
read_xlsx.py data.xlsx --all-sheets-json

# Convert to CSV (stdout)
read_xlsx.py data.xlsx --csv

# Convert to CSV file
read_xlsx.py data.xlsx --csv --output summary.csv

# JSON to file
read_xlsx.py data.xlsx --json --output data.json
```

## Help

```sh
read_xlsx.py --help
```
