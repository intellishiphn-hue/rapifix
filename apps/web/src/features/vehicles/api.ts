import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where, writeBatch,
  type QueryConstraint,
} from "firebase/firestore";
import { deleteObject, ref as storageRef } from "firebase/storage";
import {
  buildSearchKeywords, col, normalizePlate, searchToken, storagePath,
  type Customer, type MileageEntry, type Vehicle, type VehicleInput, type VehiclePhoto,
} from "@rapifix/shared";
import { db, storage, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";
import { newId, uploadImage } from "@/lib/storage";

const vehiclesCol = () => collection(db, col.vehicles(TENANT_ID));
export const vehicleRef = (id: string) => doc(db, col.vehicles(TENANT_ID), id);

function toDoc(input: VehicleInput, owner: Pick<Customer, "fullName" | "phone">) {
  const plate = normalizePlate(input.plate);
  const vin = input.vin.trim().toUpperCase();
  return {
    ...input,
    plate,
    vin,
    make: input.make.trim(),
    model: input.model.trim(),
    customer: { fullName: owner.fullName, phone: owner.phone },
    searchKeywords: buildSearchKeywords([plate, input.make, input.model, String(input.year), input.color, vin, owner.fullName]),
  };
}

/** Busca otro vehículo activo con la misma placa (evita duplicados). */
export async function findByPlate(plate: string): Promise<Vehicle | null> {
  const snap = await getDocs(query(vehiclesCol(), where("plate", "==", normalizePlate(plate)), limit(2)));
  const found = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Vehicle).find((v) => !v.archived);
  return found ?? null;
}

export async function createVehicle(input: VehicleInput, owner: Customer, uid: string, byName: string): Promise<string> {
  const id = doc(vehiclesCol()).id;
  const batch = writeBatch(db);
  batch.set(vehicleRef(id), {
    ...toDoc(input, owner),
    mileageUpdatedAt: serverTimestamp(),
    coverPhotoUrl: "",
    photoCount: 0,
    archived: false,
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  batch.set(doc(collection(db, col.mileageLog(TENANT_ID, id))), {
    mileage: input.mileage, source: "manual", note: "Registro inicial", at: serverTimestamp(), by: uid, byName,
  });
  await batch.commit();
  return id;
}

export async function updateVehicle(id: string, input: VehicleInput, owner: Customer, previousMileage: number, uid: string, byName: string) {
  const batch = writeBatch(db);
  batch.update(vehicleRef(id), {
    ...toDoc(input, owner),
    ...(input.mileage !== previousMileage ? { mileageUpdatedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  if (input.mileage !== previousMileage) {
    batch.set(doc(collection(db, col.mileageLog(TENANT_ID, id))), {
      mileage: input.mileage, source: "manual", note: "Actualizado al editar el vehículo", at: serverTimestamp(), by: uid, byName,
    });
  }
  await batch.commit();
}

export async function addMileage(vehicleId: string, mileage: number, note: string, uid: string, byName: string) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, col.mileageLog(TENANT_ID, vehicleId))), {
    mileage, source: "manual", note, at: serverTimestamp(), by: uid, byName,
  });
  batch.update(vehicleRef(vehicleId), { mileage, mileageUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: uid });
  await batch.commit();
}

export async function setVehicleArchived(id: string, archived: boolean, uid: string) {
  await updateVehicle_raw(id, { archived }, uid);
}

async function updateVehicle_raw(id: string, data: Record<string, unknown>, uid: string) {
  await updateDoc(vehicleRef(id), { ...data, updatedAt: serverTimestamp(), updatedBy: uid });
}

export async function uploadVehiclePhoto(vehicleId: string, file: File, caption: string, uid: string, byName: string, setAsCover: boolean, onProgress?: (p: number) => void) {
  const fileId = newId();
  const path = storagePath.vehiclePhoto(TENANT_ID, vehicleId, fileId);
  const url = await uploadImage(file, path, onProgress);
  await addDoc(collection(db, col.vehiclePhotos(TENANT_ID, vehicleId)), {
    url, storagePath: path, caption, at: serverTimestamp(), by: uid, byName,
  });
  if (setAsCover) await updateVehicle_raw(vehicleId, { coverPhotoUrl: url }, uid);
  return url;
}

export async function setCoverPhoto(vehicleId: string, url: string, uid: string) {
  await updateVehicle_raw(vehicleId, { coverPhotoUrl: url }, uid);
}

export async function deleteVehiclePhoto(vehicleId: string, photo: VehiclePhoto, wasCover: boolean, uid: string) {
  await deleteDoc(doc(db, col.vehiclePhotos(TENANT_ID, vehicleId), photo.id));
  await deleteObject(storageRef(storage, photo.storagePath)).catch(() => undefined);
  if (wasCover) await updateVehicle_raw(vehicleId, { coverPhotoUrl: "" }, uid);
}

export type VehicleFilter = "active" | "archived";

export function useVehicles(opts: { search: string; filter: VehicleFilter; pageSize: number }) {
  const token = searchToken(opts.search);
  const constraints: QueryConstraint[] = [];
  if (token.length >= 2) constraints.push(where("searchKeywords", "array-contains", token));
  else constraints.push(where("archived", "==", opts.filter === "archived"));
  constraints.push(orderBy("createdAt", "desc"), limit(opts.pageSize));
  const state = useQueryData<Vehicle>(query(vehiclesCol(), ...constraints), `vehicles|${token}|${opts.filter}|${opts.pageSize}`);
  const data = token.length >= 2 ? state.data.filter((v) => v.archived === (opts.filter === "archived")) : state.data;
  return { ...state, data, hasMore: state.data.length >= opts.pageSize };
}

export function useCustomerVehicles(customerId: string | undefined) {
  return useQueryData<Vehicle>(
    customerId ? query(vehiclesCol(), where("customerId", "==", customerId), orderBy("createdAt", "desc")) : null,
    `customer-vehicles-${customerId}`,
  );
}

export function useVehicle(id: string | undefined) {
  return useDocData<Vehicle>(id ? vehicleRef(id) : null, `vehicle-${id}`);
}

export function useMileageLog(vehicleId: string | undefined) {
  return useQueryData<MileageEntry>(
    vehicleId ? query(collection(db, col.mileageLog(TENANT_ID, vehicleId)), orderBy("at", "desc"), limit(50)) : null,
    `mileage-${vehicleId}`,
  );
}

export function useVehiclePhotos(vehicleId: string | undefined) {
  return useQueryData<VehiclePhoto>(
    vehicleId ? query(collection(db, col.vehiclePhotos(TENANT_ID, vehicleId)), orderBy("at", "desc")) : null,
    `photos-${vehicleId}`,
  );
}
