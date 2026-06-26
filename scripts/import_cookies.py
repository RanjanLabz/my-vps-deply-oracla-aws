import sqlite3
import uuid
import json
from datetime import datetime, timezone

db = sqlite3.connect("/app/data/flow_agent.db")
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# ── Account 1 ──────────────────────────────────────────
pid1 = "35e030c2-6af3-42f2-bf0a-422339630fa1"
cookies1 = json.dumps([
    {"domain":"labs.google","hostOnly":True,"httpOnly":True,"name":"__Host-next-auth.csrf-token","path":"/","sameSite":"lax","secure":True,"session":True,"value":"0504219c9a32f104a32d9b2741f5f67a488c3e7583f1d65aa9f1b57e4da72ab7%7C60e7c4f90b5afad52ac7573fdc2790aefb7b517c13a6f4a0914e3701925a80d8"},
    {"domain":"labs.google","hostOnly":True,"httpOnly":True,"name":"__Secure-next-auth.callback-url","path":"/","sameSite":"lax","secure":True,"session":True,"value":"https%3A%2F%2Flabs.google"},
    {"domain":"labs.google","expirationDate":1785045549.792872,"hostOnly":True,"httpOnly":True,"name":"__Secure-next-auth.session-token","path":"/","sameSite":"lax","secure":True,"session":False,"value":"eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..VBnxlx73b6bRzFCu.7bHelYOXmbOXPlJmaIdwVlGP4si4BSOs3Lebb8tIDwwLHIimu01AoEXyjER0uQoW-XYSCsV5ERQgwiEm97pvNdxofQgU2GrYLD9PNvo5KThsvKoIz5jKT28Ok376Qods0AwwyQcMwUeh5D7o1r6btlUMYNaVP9VdaVSQ7bAj0xaKVjPq5BmYlZajR_ktf5F40AGBHSDfa7xk0PKx8jvK7Ss1DVbXDXlg0R9wf1mNPqpR70ebdMBQpYj-63M4F-QqzEMTeAJtZSJv3j9PCTjIvTrIVpI165DYi_rcRWtWbgqJie4G0bquNH2jlassBrwftDJ-NTe36rRzhTyY51z3shFX3G5WLehWnHf2YKcHDTBsdApt-Dj0mIeAySqFBsgAdgdtWmuFeOosy26_dDrWOXK_KcCfId5a6h_RPBUupgfjaawuj-YAh2zHs6W9MzZT_oflx8fSusRSYNSNVTPkWTttQXwXZ1aODawiLlJP9ZbRtd0sdjMnEzOUU0lru_f9FsMQH8oCH4cwE7OwIta-gKr6b1SP3FL3Y5enCvawc65f9JuHJzt5NS-5OIIJBquK5z55h0hzpFkAh-sfWdgqksvQK3Y41dO-XVb6OkXtXlXjhdG3TLPw7hiq1Uquk4b077y5lK9S1VvTNxjymlwWpy6fXPqJFvXUg5XxOLr9jmEt4V8VitGok1zlSh1WqNnfb6H_TPE__OkqlTgPVtEE1nfTrGleUDhg5k7mgtlQqZW4nOF5cGxsaNO2J7QDyGkaflBlJaH3LkCEMCqIIAUPBwUuSfhZtZCZ5hlpB3OC1YNq9IhcKBPmyFAJSl91yv8bl2F0UX-d4sGkDx1-a0eHPSrqnvo-14BU_Jqcxt1LdXcNEuKJPuIryUSW0rCqpQazfymljlfnh2-m9ryynDHCZ1iMUpMCNoWpy51FTYDgunOiNrDXOhqOOySbmCtWDSYkkpSfmCLLBYxogWrLUv0scCmm.NZUDdI1nX04qEqidgkYpow"}
])

# ── Account 2 ──────────────────────────────────────────
pid2 = "2aaa3c7b-6d99-4d49-aaf7-d100f4161452"
cookies2 = json.dumps([
    {"domain":"labs.google","hostOnly":True,"httpOnly":True,"name":"__Host-next-auth.csrf-token","path":"/","sameSite":"lax","secure":True,"session":True,"value":"fb698c7c6986b9a099368f5d3479c2b2dd4188bfe0303771c6809173be865818%7Cb00e9b6b25aebc23575647e7c58a11601222a0b3fe002ef9a7020ac77c80ecb7"},
    {"domain":"labs.google","hostOnly":True,"httpOnly":True,"name":"__Secure-next-auth.callback-url","path":"/","sameSite":"lax","secure":True,"session":True,"value":"https%3A%2F%2Flabs.google%2Ffx%2Ftools%2Fflow%2Fproject%2F35e030c2-6af3-42f2-bf0a-422339630fa1"},
    {"domain":"labs.google","expirationDate":1785045793.10265,"hostOnly":True,"httpOnly":True,"name":"__Secure-next-auth.session-token","path":"/","sameSite":"lax","secure":True,"session":False,"value":"eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..Pvt0qS9OeblCUIBT.EzigSoM2Y9D26rF7SN6IjkRGpz6UELiVMvaytq2c2Jp2-Dzux9Sv_IYcjkCJOtcHKZ30pQYgO8UPHR7wBAKgMyUPFrRRG9bIzXfQj1pA86LE8GtypO55bWxwSnr_JC8pHPI2sXw8ekT8v9Gp4gU3uOhZw7mjRB7zyQsSufmIRF4KWgBVStQl32EWlrFRJjjqBiSYfsd29sIvEZSM8f9kPYBPZeozqrUPW4ukYPd3NqiXfNT4Dp73VL-2BgWtXz1M3E4iZ9b00DbB14mlYA9OadUhYs77mSA2SIk2ItBeKxHa_Uf_Wov3CfwS5ZZW2-yEt7Zf8D-S0yhkBTZlwm5yuFoqYg-xAyN4kCHQF9YDeZg1XV9brGWu6qX9Wxrtxm5NbIkKMQVGRQztCAK1kD5qYGJZNEMa32hNRwexfrijaC4Rii9fEmdGdeZJUplyaKehPGweedax1oAYA84PQ_81iKmEcRbpYq_EQGPNvN3RmEZtBdbQnLko3f79Na8d81ajC6Su3loj1uiT5qIXFy0RmpRC3W-RJD8P5QDQyHHjuEPj-nerfgrKzkIMWJiwRIcGSMsmk7cxqYpSif9iXR_Hv_85S6nMkkAeWAus_GtMimZ6qy4IJuUD0RCBcMn0WVKVkL7TTgPOKgptFbbvthdEqt3Oi0HNz_rMpzokfybFftuT1J8sSqCFaHOsTdVGiD4v566-X4OPy0fKVjU382W0EfsOJyY36AhnO3Y5tiQzb0KeoenMbgqoBhLv2yOZvczC3gd9IE8rdv2hggph8bMNYghg7vj3r9ALtBpCNYKpRNM7n-v5DPNOH0cZ8yfB6cZQ4OWko_FDGuh6JLZ7ewv9hUGz-DHu_9_0suq7G4Vp5sLnJsXBlhvkffttWNx6YvT5Jkp_ql80xQXkR_V8fu_WBkrL-j2FSc-V-u9698jhRwgGGk8-6HN-2RWSt-AdWD0mvde2iUI9Tu7BuUu90SeUHyaDd_RStyYhw1KFDQ.F7r5NmgVDWxiOpgRdnxLyA"}
])

# ── Create both projects ───────────────────────────────
for pid, name in [(pid1, "Google Labs Account 1"), (pid2, "Google Labs Account 2")]:
    try:
        db.execute("INSERT INTO project (id, name, created_at) VALUES (?, ?, ?)", (pid, name, now))
        print(f"Project created: {pid} ({name})")
    except Exception as e:
        print(f"Project {pid}: {e}")
db.commit()

# ── Find and update existing account 1 ─────────────────
cur = db.execute("SELECT id FROM account WHERE project_id=?", (pid1,))
existing1 = cur.fetchone()
aid1 = existing1[0] if existing1 else str(uuid.uuid4())

if existing1:
    db.execute("UPDATE account SET cookies=?, models=?, status='ACTIVE' WHERE id=?", (cookies1, '["NARWHAL"]', aid1))
    print(f"Account 1 updated: {aid1}")
else:
    db.execute(
        "INSERT INTO account (id, site, name, cookies, models, max_count, in_use, locked, status, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (aid1, "labs.google", "Google Labs Account 1", cookies1, '["NARWHAL"]', 1, 0, 0, "ACTIVE", now, pid1)
    )
    print(f"Account 1 created: {aid1}")

# ── Create account 2 ───────────────────────────────────
aid2 = str(uuid.uuid4())
try:
    db.execute(
        "INSERT INTO account (id, site, name, cookies, models, max_count, in_use, locked, status, created_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (aid2, "labs.google", "Google Labs Account 2", cookies2, '["NARWHAL"]', 1, 0, 0, "ACTIVE", now, pid2)
    )
    print(f"Account 2 created: {aid2}")
except Exception as e:
    print(f"Account 2 error: {e}")

db.commit()

# ── Verify ─────────────────────────────────────────────
print("\n=== Projects ===")
for row in db.execute("SELECT id, name FROM project"):
    print(f"  {row[0]}: {row[1]}")

print("\n=== Accounts ===")
for row in db.execute("SELECT id, name, project_id, length(cookies) as cookie_len FROM account"):
    print(f"  {row[0]}: {row[1]} | project={row[2]} | cookies={row[3]} chars")

db.close()
