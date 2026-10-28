/** "Where it sits": the placement of each part of an asset (decision 0014), from inspect details. */
import type { Where } from '../../../../../../packages/space/src/index.ts';
import type { InspectResult } from '../../../protocol.ts';
import { Empty, Section } from '../../components/common.tsx';

const exposure = (w: Where): string => (w.exposedTo === 'outside' ? 'open air' : w.exposedTo === 'ground' ? 'ground' : w.exposedTo === 'water' ? 'water' : w.exposedTo.label);

export function PlacementSection({ data }: { data: InspectResult }) {
  const where = (data.details?.placement as Where[] | undefined) ?? [];
  const parts = new Map<string, Where[]>();
  for (const w of where) parts.set(w.part, [...(parts.get(w.part) ?? []), w]);
  return (
    <Section title="Where it sits" right={<span class="small muted">{parts.size} parts</span>}>
      {!parts.size ? (
        <Empty>Parts are placed as they are built.</Empty>
      ) : (
        <table class="tbl tbl-mini">
          <tbody>
            {[...parts].map(([part, list]) => (
              <tr key={part}>
                <td>{list[0]!.label}</td>
                <td>
                  {list.map((w, i) => (
                    <div key={i} title={w.description}>
                      <span class="muted">meets</span> {exposure(w)}
                      {w.orientation && w.orientation.tilt > 5 && w.orientation.tilt < 175 && <span class="muted num"> · {Math.round(w.orientation.azimuth)}° / {Math.round(w.orientation.tilt)}°</span>}
                      {'medium' in w.in && <span class="muted num"> · {Math.round(w.in.depth * 100)}–{Math.round((w.in.depth + (w.in.thickness ?? 0)) * 100)} cm deep</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
