import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { T, createEnv, ctxAs, type Role } from "./helpers";

let env: RulesTestEnvironment;

const MB = 1024 * 1024;
const bytes = (n: number) => new Uint8Array(n);
const JPG = { contentType: "image/jpeg" };
const PNG = { contentType: "image/png" };
const PDF = { contentType: "application/pdf" };
const TXT = { contentType: "text/plain" };

const st = (role: Role, uid?: string) => ctxAs(env, role, uid).storage();
const anon = () => env.unauthenticatedContext().storage();

/** put() devuelve una UploadTask (thenable); la envolvemos en una Promise real */
const upload = (s: ReturnType<typeof anon>, path: string, data: Uint8Array, meta: { contentType: string }) =>
  Promise.resolve(s.ref(path).put(data, meta));

beforeAll(async () => {
  env = await createEnv({ storage: true });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    // La regla de fotos de órdenes lee la orden en Firestore (technicianIds)
    const db = ctx.firestore();
    await db.doc(`${T}/workOrders/wo-asignada`).set({ technicianIds: ["tech1"] });
    await db.doc(`${T}/workOrders/wo-otra`).set({ technicianIds: ["tech2"] });

    const s = ctx.storage();
    await s.ref(`${T}/branding/logo.png`).put(bytes(1024), PNG);
    await s.ref(`${T}/vehicles/v1/photos/existente.jpg`).put(bytes(1024), JPG);
    await s.ref(`${T}/expenses/recibo.pdf`).put(bytes(1024), PDF);
  });
});

// ---------------------------------------------------------------------------
describe("fotos de vehículos", () => {
  const path = `${T}/vehicles/v1/photos/nueva.jpg`;

  it("recepción sube una foto (JPEG pequeño)", async () => {
    await assertSucceeds(upload(st("reception"), path, bytes(50 * 1024), JPG));
  });

  it("no se aceptan fotos de más de 10 MB", async () => {
    await assertFails(upload(st("reception"), path, bytes(10 * MB + 1), JPG));
  });

  it("no se aceptan archivos que no son imagen", async () => {
    await assertFails(upload(st("reception"), `${T}/vehicles/v1/photos/doc.pdf`, bytes(1024), PDF));
    await assertFails(upload(st("reception"), `${T}/vehicles/v1/photos/nota.txt`, bytes(1024), TXT));
  });

  it("técnico y bodega no suben fotos de vehículos", async () => {
    await assertFails(upload(st("technician"), path, bytes(1024), JPG));
    await assertFails(upload(st("warehouse"), path, bytes(1024), JPG));
  });

  it("sin sesión u otro taller no suben ni ven fotos", async () => {
    const otro = env.authenticatedContext("intruso", { tid: "otro", role: "admin" }).storage();
    await assertFails(upload(anon(), path, bytes(1024), JPG));
    await assertFails(upload(otro, path, bytes(1024), JPG));
    await assertFails(anon().ref(`${T}/vehicles/v1/photos/existente.jpg`).getMetadata());
    await assertFails(otro.ref(`${T}/vehicles/v1/photos/existente.jpg`).getMetadata());
  });

  it("cualquier rol del taller ve las fotos", async () => {
    await assertSucceeds(st("technician").ref(`${T}/vehicles/v1/photos/existente.jpg`).getMetadata());
  });

  it("no se reemplaza una foto existente; solo admin/gerente borran", async () => {
    await assertFails(upload(st("reception"), `${T}/vehicles/v1/photos/existente.jpg`, bytes(1024), JPG));
    await assertFails(st("reception").ref(`${T}/vehicles/v1/photos/existente.jpg`).delete());
    await assertSucceeds(st("manager").ref(`${T}/vehicles/v1/photos/existente.jpg`).delete());
  });
});

// ---------------------------------------------------------------------------
describe("fotos de órdenes de trabajo", () => {
  it("técnico asignado sube foto a su orden", async () => {
    await assertSucceeds(upload(st("technician"), `${T}/workOrders/wo-asignada/photos/a.jpg`, bytes(1024), JPG));
  });

  it("técnico no sube fotos a una orden ajena", async () => {
    await assertFails(upload(st("technician"), `${T}/workOrders/wo-otra/photos/a.jpg`, bytes(1024), JPG));
  });

  it("recepción sube a cualquier orden; vendedor no", async () => {
    await assertSucceeds(upload(st("reception"), `${T}/workOrders/wo-otra/photos/a.jpg`, bytes(1024), JPG));
    await assertFails(upload(st("seller"), `${T}/workOrders/wo-otra/photos/b.jpg`, bytes(1024), JPG));
  });
});

// ---------------------------------------------------------------------------
describe("comprobantes de gastos", () => {
  it("admin sube un PDF", async () => {
    await assertSucceeds(upload(st("admin"), `${T}/expenses/factura.pdf`, bytes(20 * 1024), PDF));
  });

  it("gerente sube una foto", async () => {
    await assertSucceeds(upload(st("manager"), `${T}/expenses/factura.jpg`, bytes(20 * 1024), JPG));
  });

  it("recepción, bodega, vendedor y técnico no suben comprobantes", async () => {
    for (const r of ["reception", "warehouse", "seller", "technician"] as const) {
      await assertFails(upload(st(r), `${T}/expenses/f-${r}.pdf`, bytes(1024), PDF));
    }
  });

  it("no se aceptan otros tipos ni más de 10 MB", async () => {
    await assertFails(upload(st("admin"), `${T}/expenses/f.txt`, bytes(1024), TXT));
    await assertFails(upload(st("admin"), `${T}/expenses/grande.pdf`, bytes(10 * MB + 1), PDF));
  });

  it("solo admin y gerente ven comprobantes", async () => {
    await assertSucceeds(st("admin").ref(`${T}/expenses/recibo.pdf`).getMetadata());
    await assertSucceeds(st("manager").ref(`${T}/expenses/recibo.pdf`).getMetadata());
    await assertFails(st("reception").ref(`${T}/expenses/recibo.pdf`).getMetadata());
    await assertFails(st("warehouse").ref(`${T}/expenses/recibo.pdf`).getMetadata());
    await assertFails(anon().ref(`${T}/expenses/recibo.pdf`).getMetadata());
  });

  it("nadie reemplaza ni borra comprobantes", async () => {
    await assertFails(upload(st("admin"), `${T}/expenses/recibo.pdf`, bytes(1024), PDF));
    await assertFails(st("admin").ref(`${T}/expenses/recibo.pdf`).delete());
  });
});

// ---------------------------------------------------------------------------
describe("logo del taller (branding)", () => {
  it("lectura pública, sin sesión", async () => {
    await assertSucceeds(anon().ref(`${T}/branding/logo.png`).getMetadata());
  });

  it("gerente sube el logo; recepción y sin sesión no", async () => {
    await assertSucceeds(upload(st("manager"), `${T}/branding/logo2.png`, bytes(100 * 1024), PNG));
    await assertFails(upload(st("reception"), `${T}/branding/logo3.png`, bytes(1024), PNG));
    await assertFails(upload(anon(), `${T}/branding/logo4.png`, bytes(1024), PNG));
  });

  it("el logo debe ser imagen de menos de 2 MB", async () => {
    await assertFails(upload(st("admin"), `${T}/branding/grande.png`, bytes(2 * MB + 1), PNG));
    await assertFails(upload(st("admin"), `${T}/branding/logo.pdf`, bytes(1024), PDF));
  });
});

// ---------------------------------------------------------------------------
describe("rutas no declaradas", () => {
  it("todo lo demás está cerrado", async () => {
    await assertFails(upload(st("admin"), "cualquier/archivo.jpg", bytes(1024), JPG));
    await assertFails(upload(st("admin"), `${T}/otra/archivo.jpg`, bytes(1024), JPG));
    await assertFails(st("admin").ref(`${T}/otra/archivo.jpg`).getMetadata());
  });
});
