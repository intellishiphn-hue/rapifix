import { describe, expect, it } from "vitest";
import { countWashPhotos, groupWashPhotos, washPhotoSlots, WASH_PHOTOS_PER_STAGE, WASH_PHOTO_STAGES } from "../carwash";
import { carwashCol, carwashStoragePath } from "../tenant";

describe("fotos del lavado", () => {
  it("etapas ingreso y salida, máximo 6 por etapa", () => {
    expect(WASH_PHOTO_STAGES).toEqual(["entry", "exit"]);
    expect(WASH_PHOTOS_PER_STAGE).toBe(6);
  });

  it("cuenta por etapa e ignora etapas desconocidas", () => {
    expect(countWashPhotos([])).toEqual({ entry: 0, exit: 0 });
    expect(countWashPhotos([{ stage: "entry" }, { stage: "exit" }, { stage: "entry" }, { stage: "otra" }])).toEqual({ entry: 2, exit: 1 });
  });

  it("espacios disponibles: guardadas + por subir, nunca negativo", () => {
    expect(washPhotoSlots(0)).toBe(6);
    expect(washPhotoSlots(4)).toBe(2);
    expect(washPhotoSlots(4, 2)).toBe(0);
    expect(washPhotoSlots(6, 3)).toBe(0);
    expect(washPhotoSlots(-1, -1)).toBe(6);
    expect(washPhotoSlots(1, 0, 3)).toBe(2);
  });

  it("agrupa por etapa en orden de toma y corta en el máximo", () => {
    const photos = [
      { id: "b", stage: "entry", at: 2 },
      { id: "a", stage: "entry", at: 1 },
      { id: "x", stage: "exit", at: 5 },
      { id: "z", stage: "raro", at: 0 },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, stage: "exit", at: 10 + i })),
    ];
    const g = groupWashPhotos(photos);
    expect(g.entry.map((p) => p.id)).toEqual(["a", "b"]);
    expect(g.exit).toHaveLength(6);
    expect(g.exit[0]!.id).toBe("x");
  });

  it("rutas de Firestore y Storage", () => {
    expect(carwashCol.washPhotos("t1", "w1")).toBe("tenants/t1/carwashWashes/w1/photos");
    expect(carwashStoragePath.photo("t1", "w1", "f1")).toBe("tenants/t1/carwashWashes/w1/photos/f1.jpg");
  });
});
