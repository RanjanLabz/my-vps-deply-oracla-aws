import sqlite3
import uuid
from datetime import datetime

db = sqlite3.connect("/app/data/flow_agent.db")

pid = "35e030c2-6af3-42f2-bf0a-422339630fa1"
aid = str(uuid.uuid4())
now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

# Insert project
try:
    db.execute("INSERT INTO project (id, name, created_at) VALUES (?, ?, ?)", (pid, "Google Labs", now))
    db.commit()
    print("Project created:", pid)
except Exception as e:
    db.rollback()
    print("Project exists or error:", e)

# Insert account
try:
    db.execute(
        "INSERT INTO account (id, site, name, cookies, models, max_count, in_use, locked, status, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (aid, "labs.google", "Google Labs Account", "[]", '["NARWHAL"]', 1, 0, 0, "ACTIVE", now, pid)
    )
    db.commit()
    print("Account created:", aid)
except Exception as e:
    db.rollback()
    print("Account exists or error:", e)

# Verify
print("Projects:", db.execute("SELECT id, name FROM project").fetchall())
print("Accounts:", db.execute("SELECT id, name, project_id FROM account").fetchall())
db.close()
