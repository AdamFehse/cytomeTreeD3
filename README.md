# CytomeTreeD3

# [DEMO HERE](https://github.com/AdamFehse/cytomeTreeD3)

Flow cytometry analysis with automatic gating using the CytomeTree algorithm. Upload FCS files and visualize the binary tree in your browser.

## Stack
- **Backend**: R Plumber + IFC (FCS parser) + CytomeTree
- **Frontend**: React + TypeScript + D3
- **Deployment**: Docker on Render + GitHub Pages

## How It Works
1. Upload FCS file
2. Backend parses with IFC
3. CytomeTree generates binary tree
4. Converts to nodes/links JSON
5. D3 renders interactive visualization