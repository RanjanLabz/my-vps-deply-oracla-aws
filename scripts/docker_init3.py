import sqlite3

db = sqlite3.connect("/app/data/flow_agent.db")
pid = "35e030c2-6af3-42f2-bf0a-422339630fa1"
aid = "f580b555-d574-4fd8-b84d-a6f293c80a6c"

# Insert project
try:
    db.execute("INSERT INTO project (id, name, created_at) VALUES (?, ?, datetime('now'))", (pid, "Google Labs"))
    db.commit()
    print("Project created")
except:
    db.rollback()
    print("Project exists")

# Bind account to project
db.execute("UPDATE account SET project_id=? WHERE id=?", (pid, aid))
db.commit()
print("Account bound")

# Verify
print("Projects:", db.execute("SELECT id, name FROM project").fetchall())
print("Accounts:", db.execute("SELECT id, name, project_id FROM account").fetchall())
db.close()
