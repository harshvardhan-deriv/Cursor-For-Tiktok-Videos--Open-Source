# Cursor for TikTok — start backend and frontend together
# Usage: make run   (starts both; Ctrl+C stops both)
#        make backend   (backend only)
#        make frontend  (frontend only)

.PHONY: run backend frontend install-backend install-frontend

# Start both backend and frontend together; Ctrl+C stops both
run:
	@echo "Starting backend (http://127.0.0.1:8001) and frontend (http://localhost:5173) ..."
	@(cd backend && . venv/bin/activate && uvicorn main:app --reload --port 8001) & \
	(cd frontend && npm run dev) & \
	wait

# Backend only (run from project root; expects backend/venv)
backend:
	cd backend && (source venv/bin/activate 2>/dev/null || true) && uvicorn main:app --reload --port 8001

# Frontend only
frontend:
	cd frontend && npm run dev

# Install backend deps (Python 3.10+ venv)
install-backend:
	cd backend && python3 -m venv venv && . venv/bin/activate && pip install -r requirements.txt

# Install frontend deps
install-frontend:
	cd frontend && npm install
