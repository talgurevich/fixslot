import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/index";

const app = createApp();
const PASSWORD = "test-password";

async function loginAgent() {
  const agent = request.agent(app);
  const res = await agent.post("/login").send({ password: PASSWORD });
  expect(res.status).toBe(302);
  return agent;
}

describe("dashboard API", () => {
  it("rejects unauthenticated API access", async () => {
    const res = await request(app).get("/api/bookings");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await request(app).post("/login").send({ password: "nope" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login?error=1");
  });

  it("returns the config (creating it on first read)", async () => {
    const agent = await loginAgent();
    const res = await agent.get("/api/config");
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBeTruthy();
    expect(res.body.slotDurationMinutes).toBe(60);
  });

  it("replaces availability rules and reads them back", async () => {
    const agent = await loginAgent();
    const rules = [
      { weekday: 1, startTime: "09:00", endTime: "12:00" },
      { weekday: 3, startTime: "16:00", endTime: "19:00" },
    ];
    const put = await agent.put("/api/availability").send({ rules });
    expect(put.status).toBe(200);

    const get = await agent.get("/api/availability");
    expect(get.body).toHaveLength(2);
    expect(get.body[0]).toMatchObject({ weekday: 1, startTime: "09:00" });
  });

  it("rejects an invalid availability rule", async () => {
    const agent = await loginAgent();
    const res = await agent.put("/api/availability").send({ rules: [{ weekday: 9, startTime: "x", endTime: "y" }] });
    expect(res.status).toBe(400);
  });

  it("adds, lists, and deletes a blackout", async () => {
    const agent = await loginAgent();
    const add = await agent.post("/api/blackouts").send({ date: "2026-07-01" });
    expect(add.status).toBe(201);
    const id = add.body.id;

    const list = await agent.get("/api/blackouts");
    expect(list.body.some((b: { id: number }) => b.id === id)).toBe(true);

    const del = await agent.delete(`/api/blackouts/${id}`);
    expect(del.status).toBe(204);
  });

  it("updates settings via POST /api/config", async () => {
    const agent = await loginAgent();
    const res = await agent.post("/api/config").send({ trainerPhone: "972541112233", maxSlotsOffered: 7 });
    expect(res.status).toBe(200);
    expect(res.body.trainerPhone).toBe("972541112233");
    expect(res.body.maxSlotsOffered).toBe(7);
  });

  it("lists bookings (read-only) and exposes no cancel endpoint", async () => {
    const agent = await loginAgent();
    const res = await agent.get("/api/bookings");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("runs the dev simulator end to end", async () => {
    const agent = await loginAgent();
    // Need availability for slots to be offered.
    await agent.put("/api/availability").send({
      rules: [{ weekday: 0, startTime: "09:00", endTime: "12:00" }],
    });
    const res = await agent.post("/api/dev/sim").send({ phone: "972500000000", text: "hi" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.replies)).toBe(true);
    expect(res.body.replies.length).toBeGreaterThan(0);
  });
});
