# CytoTree Explorer

Flow cytometry analysis with automatic gating using the CytomeTree algorithm. Upload FCS files and visualize the binary tree in your browser.

## Quick Start

### Backend
```bash
cd backend
docker build -t cytotree-backend .
docker run -p 8000:8000 cytotree-backend
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5173` and upload an FCS file from `FlowRepository_FR-FCM-ZZYY_files/`

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
