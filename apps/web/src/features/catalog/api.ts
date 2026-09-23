import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, type QueryConstraint } from "firebase/firestore";
import {
  buildSearchKeywords, catalogCol, searchToken,
  type InventoryMovement, type MovementInput, type Product, type ProductCost, type ProductInput, type Service, type ServiceInput,
} from "@rapifix/shared";
import { callable, db, TENANT_ID } from "@/lib/firebase";
import { useDocData, useQueryData } from "@/lib/firestore/hooks";

const productsCol = () => collection(db, catalogCol.products(TENANT_ID));
const servicesCol = () => collection(db, catalogCol.services(TENANT_ID));
export const productRef = (id: string) => doc(db, catalogCol.products(TENANT_ID), id);
export const costRef = (id: string) => doc(db, catalogCol.productCosts(TENANT_ID), id);

export const registerInventoryMovement = callable<MovementInput, { stock: number }>("registerInventoryMovement");
export const consumeOrderPart = callable<{ orderId: string; quoteId: string; itemId: string }, { stock: number }>("consumeOrderPart");

// ---------- Productos ----------
export function useProducts(opts: { search: string; showInactive: boolean; pageSize: number }) {
  const token = searchToken(opts.search);
  const c: QueryConstraint[] = token.length >= 2 ? [where("searchKeywords", "array-contains", token), orderBy("name")] : opts.showInactive ? [orderBy("name")] : [where("active", "==", true), orderBy("name")];
  const state = useQueryData<Product>(query(productsCol(), ...c, limit(opts.pageSize)), `products|${token}|${opts.showInactive}|${opts.pageSize}`);
  const data = token.length >= 2 && !opts.showInactive ? state.data.filter((p) => p.active) : state.data;
  return { ...state, data, hasMore: state.data.length >= opts.pageSize };
}

export function useAllActiveProducts() {
  return useQueryData<Product>(query(productsCol(), where("active", "==", true), orderBy("name"), limit(1000)), "products-all-active");
}

function productDoc(input: ProductInput) {
  return { ...input, sku: input.sku.toUpperCase(), searchKeywords: buildSearchKeywords([input.name, input.sku, input.brand, input.category, input.supplier]) };
}

export async function saveProduct(id: string | null, input: ProductInput, cost: number | null, uid: string): Promise<string> {
  let pid = id;
  if (pid) {
    await updateDoc(productRef(pid), { ...productDoc(input), updatedAt: serverTimestamp(), updatedBy: uid });
  } else {
    const ref = await addDoc(productsCol(), { ...productDoc(input), stock: 0, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
    pid = ref.id;
  }
  if (cost !== null) {
    const prev = await getDoc(costRef(pid)).catch(() => null);
    const avg = prev?.exists() ? (prev.data() as ProductCost).avgCost : cost;
    await setDoc(costRef(pid), { cost, avgCost: avg || cost, lastPurchaseCost: prev?.exists() ? (prev.data() as ProductCost).lastPurchaseCost : cost, updatedAt: serverTimestamp() }, { merge: true });
  }
  return pid;
}

export function useProductCost(id: string | undefined, enabled: boolean) {
  return useDocData<ProductCost>(id && enabled ? costRef(id) : null, `cost-${id}-${enabled}`);
}

export async function fetchCost(id: string): Promise<number> {
  try {
    const s = await getDoc(costRef(id));
    return s.exists() ? ((s.data() as ProductCost).avgCost || (s.data() as ProductCost).cost || 0) : 0;
  } catch {
    return 0; // sin permiso para ver costos
  }
}

export function useMovements(productId?: string, max = 50, enabled = true) {
  const c: QueryConstraint[] = productId ? [where("productId", "==", productId), orderBy("at", "desc")] : [orderBy("at", "desc")];
  return useQueryData<InventoryMovement>(enabled ? query(collection(db, catalogCol.movements(TENANT_ID)), ...c, limit(max)) : null, `movements-${productId ?? "all"}-${max}-${enabled}`);
}

export const seedDemoCatalog = callable<void, { products: number; services: number }>("seedDemoCatalog");

// ---------- Servicios ----------
export function useServices(search: string, showInactive: boolean) {
  const token = searchToken(search);
  const c: QueryConstraint[] = token.length >= 2 ? [where("searchKeywords", "array-contains", token), orderBy("name")] : showInactive ? [orderBy("name")] : [where("active", "==", true), orderBy("name")];
  const state = useQueryData<Service>(query(servicesCol(), ...c, limit(300)), `services|${token}|${showInactive}`);
  return { ...state, data: token.length >= 2 && !showInactive ? state.data.filter((s) => s.active) : state.data };
}

export async function saveService(id: string | null, input: ServiceInput, uid: string) {
  const data = { ...input, code: input.code.toUpperCase(), searchKeywords: buildSearchKeywords([input.name, input.code, input.category]) };
  if (id) await updateDoc(doc(db, catalogCol.services(TENANT_ID), id), { ...data, updatedAt: serverTimestamp(), updatedBy: uid });
  else await addDoc(servicesCol(), { ...data, createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
}

/** Búsqueda combinada para cotizaciones y punto de venta. */
export async function searchCatalog(text: string): Promise<{ products: Product[]; services: Service[] }> {
  const token = searchToken(text);
  if (token.length < 2) {
    const [p, s] = await Promise.all([
      getDocs(query(productsCol(), where("active", "==", true), orderBy("name"), limit(8))),
      getDocs(query(servicesCol(), where("active", "==", true), orderBy("name"), limit(8))),
    ]);
    return { products: p.docs.map((d) => ({ id: d.id, ...d.data() }) as Product), services: s.docs.map((d) => ({ id: d.id, ...d.data() }) as Service) };
  }
  const [p, s] = await Promise.all([
    getDocs(query(productsCol(), where("searchKeywords", "array-contains", token), orderBy("name"), limit(10))),
    getDocs(query(servicesCol(), where("searchKeywords", "array-contains", token), orderBy("name"), limit(10))),
  ]);
  return {
    products: p.docs.map((d) => ({ id: d.id, ...d.data() }) as Product).filter((x) => x.active),
    services: s.docs.map((d) => ({ id: d.id, ...d.data() }) as Service).filter((x) => x.active),
  };
}
