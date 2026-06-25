# Start the Python agent server
Write-Host "Starting Flow Kit Agent on http://127.0.0.1:8100 ..." -ForegroundColor Cyan
& "venv\Scripts\python.exe" -m uvicorn agent.main:app --host 127.0.0.1 --port 8100 --reload
