/** Materials: stocks per store, open orders with ETA, and the order dialog. */
import { signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { Button, Empty, Pill, Progress } from '../../components/common.tsx';
import { DataTable, type Column } from '../../components/Table.tsx';
import { dateTime, eur, num, qty, relative } from '../../format.ts';
import { useProjection, useQuery } from '../../hooks.ts';
import { command, frame, select, selection, world } from '../../state.ts';

interface StoreRow {
  id: string;
  label: string;
  kind: string;
  pos: [number, number];
  contents: Record<string, number>;
}
interface OrderRow {
  id: string;
  supplier: string;
  material: string;
  store: string;
  qty: number;
  delivered: number;
  inTransit: number;
  status: string;
  orderedAt: number;
  earliest: number;
  unitPrice: number;
  direction?: 'inbound' | 'outbound';
  blockers: string[];
}

export const orderDialog = signal<{ store?: string; material?: string; qty?: number } | null>(null);
export function openOrderDialog(init: { store?: string; material?: string; qty?: number } = {}): void {
  openSeq += 1;
  orderDialog.value = init;
}

function mat(id: string) {
  return world.value?.materials.find((m) => m.id === id);
}

let openSeq = 0;
export function OrderDialog() {
  const init = orderDialog.value;
  if (!init) return null;
  return <OrderDialogInner key={openSeq} init={init} />;
}

function OrderDialogInner({ init }: { init: { store?: string; material?: string; qty?: number } }) {
  const { data: stores } = useProjection<StoreRow[]>('inventory.stocks', 0);
  const mats = (world.value?.materials ?? []).filter((m) => m.category !== 'soil' && m.category !== 'fuel');
  const [material, setMaterial] = useState(init?.material ?? mats[0]?.id ?? '');
  const [store, setStore] = useState(init?.store ?? world.value?.depotStore ?? '');
  const [amount, setAmount] = useState(init?.qty ?? 50);
  const [supplier, setSupplier] = useState<string | null>(null);
  const { data: offers } = useQuery<{ supplier: string; supplierLabel?: string; price: number; leadTimeDays: number; minOrder: number }[]>(material ? { kind: 'offers', material } : null, 0);
  useEffect(() => setSupplier(null), [material]);
  useEffect(() => {
    if (!store && stores?.[0]) setStore(stores[0].id);
  }, [stores]);
  const m = mat(material);
  const best = offers?.[0];
  const chosen = offers?.find((o) => o.supplier === supplier) ?? best;
  const close = () => (orderDialog.value = null);
  return (
    <div class="modal-back" onClick={close}>
      <div class="modal glass" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), close())}>
        <div class="modal-h">
          <b>Order material</b>
          <button class="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div class="form">
          <label>
            <span class="sc">Material</span>
            <select class="inp" value={material} onChange={(e) => setMaterial((e.currentTarget as HTMLSelectElement).value)}>
              {mats.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label} ({x.unit === 'm3' ? 'm³' : x.unit})
                </option>
              ))}
            </select>
          </label>
          <label>
            <span class="sc">Deliver to</span>
            <select class="inp" value={store} onChange={(e) => setStore((e.currentTarget as HTMLSelectElement).value)}>
              {(stores ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span class="sc">Quantity</span>
            <span class="row">
              <input class="inp num w80" type="number" min={0} value={amount} onInput={(e) => setAmount(Number((e.currentTarget as HTMLInputElement).value) || 0)} autoFocus />
              <span>{m?.unit === 'm3' ? 'm³' : m?.unit}</span>
            </span>
          </label>
        </div>
        <div class="sc muted">Offers</div>
        {offers?.length ? (
          <table class="tbl tbl-mini">
            <thead>
              <tr>
                <th />
                <th>Supplier</th>
                <th class="al-right">Price</th>
                <th class="al-right">Lead</th>
                <th class="al-right">Min.</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.supplier} class="clickable" onClick={() => setSupplier(o.supplier)}>
                  <td>
                    <input type="radio" checked={chosen?.supplier === o.supplier} />
                  </td>
                  <td>{o.supplierLabel ?? o.supplier}</td>
                  <td class="al-right num">{qty(o.price, `EUR/${m?.unit ?? ''}`, 2)}</td>
                  <td class="al-right num">{num(o.leadTimeDays, 1)} d</td>
                  <td class="al-right num">{num(o.minOrder)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No offers for this material.</Empty>
        )}
        <div class="modal-f">
          <span class="num">{chosen ? `≈ ${eur(chosen.price * amount)} delivered` : ''}</span>
          <Button
            kind="primary"
            disabled={!chosen || amount <= 0 || !store}
            onClick={async () => {
              const r = await command('inventory.order', { material, qty: amount, store, supplier: chosen!.supplier }, `Ordered ${num(amount)} ${m?.unit ?? ''} ${m?.label ?? material}`);
              if (r.ok) close();
            }}
          >
            Place order
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MaterialsTab() {
  const { data: stores } = useProjection<StoreRow[]>('inventory.stocks', 2000);
  const { data: orders } = useProjection<OrderRow[]>('inventory.orders', 2000);
  const now = frame.value?.t ?? 0;
  const storeLabel = (id: string) => stores?.find((s) => s.id === id)?.label ?? id;
  const stockRows: { key: string; store: string; storeLabel: string; material: string; qty: number }[] = [];
  for (const s of stores ?? []) for (const [m, v] of Object.entries(s.contents)) if (v > 1e-6) stockRows.push({ key: `${s.id}:${m}`, store: s.id, storeLabel: s.label, material: m, qty: v });
  const sCols: Column<(typeof stockRows)[number]>[] = [
    { key: 'store', label: 'Store', render: (r) => r.storeLabel, sort: (r) => r.storeLabel },
    {
      key: 'mat',
      label: 'Material',
      render: (r) => (
        <span>
          {mat(r.material)?.color && <i class="sw" style={{ background: mat(r.material)!.color }} />} {mat(r.material)?.label ?? r.material}
        </span>
      ),
      sort: (r) => mat(r.material)?.label ?? r.material,
    },
    { key: 'qty', label: 'Quantity', render: (r) => qty(r.qty, mat(r.material)?.unit, 1), sort: (r) => r.qty, align: 'right' },
  ];
  const open = (orders ?? []).filter((o) => o.status === 'open');
  const oCols: Column<OrderRow>[] = [
    { key: 'mat', label: 'Material', render: (o) => `${o.direction === 'outbound' ? '↗ ' : ''}${mat(o.material)?.label ?? o.material}`, sort: (o) => mat(o.material)?.label ?? o.material },
    { key: 'to', label: 'Store', render: (o) => storeLabel(o.store), sort: (o) => storeLabel(o.store) },
    {
      key: 'prog',
      label: 'Delivered',
      render: (o) => (
        <span class="row nowrap">
          <Progress value={o.delivered / Math.max(1e-9, o.qty)} thin />
          <span class="num small">
            {num(o.delivered, 0)}/{qty(o.qty, mat(o.material)?.unit, 0)}
          </span>
        </span>
      ),
      sort: (o) => o.delivered / Math.max(1e-9, o.qty),
    },
    { key: 'eta', label: 'ETA', render: (o) => (o.earliest > now ? <span title={dateTime(o.earliest)}>{relative(o.earliest, now)}</span> : o.inTransit > 0 ? 'in transit' : <span class="muted">due</span>), sort: (o) => o.earliest },
    { key: 'price', label: 'Value', render: (o) => eur(o.qty * o.unitPrice), sort: (o) => o.qty * o.unitPrice, align: 'right' },
    { key: 'st', label: '', render: (o) => (o.blockers.length ? <Pill tone="warn" label="!" /> : null), text: (o) => o.blockers.join(' ') },
  ];
  return (
    <div class="split">
      <div class="split-r grow">
        <DataTable rows={stockRows} columns={sCols} rowKey={(r) => r.key} selected={selection.value?.id ?? null} onRowClick={(r) => select(r.store, 'store', { focus: true })} initialSort={{ key: 'store', dir: 1 }} empty="No stock." />
      </div>
      <div class="split-r grow">
        <DataTable
          rows={open}
          columns={oCols}
          rowKey={(o) => o.id}
          selected={selection.value?.id ?? null}
          onRowClick={(o) => select(o.id, 'order')}
          initialSort={{ key: 'eta', dir: 1 }}
          toolbar={
            <Button small kind="primary" onClick={() => openOrderDialog({})}>
              Order…
            </Button>
          }
          empty="No open orders."
        />
      </div>
    </div>
  );
}
