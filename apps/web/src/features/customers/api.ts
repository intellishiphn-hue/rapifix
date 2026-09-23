import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where, type QueryConstraint,
} from "firebase/firestore";
import { buildSearchKeywords, col, normalizePhone, searchToken, type Customer, type CustomerInput } from "@rapifix/shared";
import { db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

const customersCol = () => collection(db, col.customers(TENANT_ID));
export const customerRef = (id: string) => doc(db, col.customers(TENANT_ID), id);

function toDoc(input: CustomerInput) {
  const phone = normalizePhone(input.phone);
  const whatsapp = input.whatsapp ? normalizePhone(input.whatsapp) : phone;
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const fullName = `${firstName} ${lastName}`;
  return {
    ...input,
    firstName,
    lastName,
    fullName,
    phone,
    whatsapp,
    email: input.email.trim().toLowerCase(),
    searchKeywords: buildSearchKeywords([fullName, input.phone, phone, whatsapp, input.email, input.idNumber, input.rtn, input.city]),
  };
}

export async function createCustomer(input: CustomerInput, uid: string): Promise<string> {
  const ref = await addDoc(customersCol(), {
    ...toDoc(input),
    vehicleCount: 0,
    openOrders: 0,
    balanceDue: 0,
    lastVisitAt: null,
    createdAt: serverTimestamp(),
    createdBy: uid,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
  return ref.id;
}

export async function updateCustomer(id: string, input: CustomerInput, uid: string) {
  await updateDoc(customerRef(id), { ...toDoc(input), updatedAt: serverTimestamp(), updatedBy: uid });
}

export async function setCustomerStatus(id: string, status: Customer["status"], uid: string) {
  await updateDoc(customerRef(id), { status, updatedAt: serverTimestamp(), updatedBy: uid });
}

/** Busca clientes con el mismo teléfono (para avisar duplicados). */
export async function findByPhone(phone: string): Promise<Customer[]> {
  const snap = await getDocs(query(customersCol(), where("phone", "==", normalizePhone(phone)), limit(3)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer);
}

export type StatusFilter = "all" | "active" | "inactive";

export function useCustomers(opts: { search: string; status: StatusFilter; pageSize: number }) {
  const token = searchToken(opts.search);
  const constraints: QueryConstraint[] = [];
  if (token.length >= 2) constraints.push(where("searchKeywords", "array-contains", token));
  else if (opts.status !== "all") constraints.push(where("status", "==", opts.status));
  constraints.push(orderBy("createdAt", "desc"), limit(opts.pageSize));

  const key = `customers|${token}|${opts.status}|${opts.pageSize}`;
  const state = useQueryData<Customer>(query(customersCol(), ...constraints), key);
  const data = token.length >= 2 && opts.status !== "all" ? state.data.filter((c) => c.status === opts.status) : state.data;
  return { ...state, data, hasMore: state.data.length >= opts.pageSize };
}

export function useCustomer(id: string | undefined) {
  return useDocData<Customer>(id ? customerRef(id) : null, `customer-${id}`);
}

/** Búsqueda rápida para selectores (ej. elegir dueño de un vehículo) */
export async function searchCustomers(text: string, max = 8): Promise<Customer[]> {
  const token = searchToken(text);
  const q = token.length >= 2
    ? query(customersCol(), where("searchKeywords", "array-contains", token), limit(max))
    : query(customersCol(), orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Customer);
}
