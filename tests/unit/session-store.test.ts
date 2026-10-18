import { SessionStore } from "@/lib/session-store";

describe("SessionStore", () => {
  it("creates sessions with device and IP and lists them per wallet", () => {
    const store = new SessionStore();
    const session = store.create("GA", "Firefox", "1.2.3.4");
    store.create("GB", "Chrome", "5.6.7.8");

    expect(store.list("GA")).toEqual([session]);
    expect(session).toMatchObject({ device: "Firefox", ip: "1.2.3.4" });
  });

  it("revokes a single session owned by the wallet", () => {
    const store = new SessionStore();
    const session = store.create("GA", "Firefox", "1.2.3.4");

    expect(store.revoke("GB", session.id)).toBe(false);
    expect(store.revoke("GA", session.id)).toBe(true);
    expect(store.isActive(session.id)).toBe(false);
  });

  it("revokes all sessions for a wallet", () => {
    const store = new SessionStore();
    store.create("GA", "Firefox", "1.2.3.4");
    store.create("GA", "Safari", "1.2.3.5");
    const other = store.create("GB", "Chrome", "5.6.7.8");

    expect(store.revokeAll("GA")).toBe(2);
    expect(store.list("GA")).toEqual([]);
    expect(store.isActive(other.id)).toBe(true);
  });
});
