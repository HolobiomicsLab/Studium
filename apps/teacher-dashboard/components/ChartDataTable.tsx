import type { Key, ReactNode } from "react";

export type ChartDataColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  rowHeader?: boolean;
};

type Props<Row> = {
  caption: string;
  columns: readonly ChartDataColumn<Row>[];
  rows: readonly Row[];
  rowKey?: (row: Row, index: number) => Key;
};

/**
 * A semantic data equivalent for a visual chart. It stays in the accessibility
 * tree while analytics.css removes it from the visual layout.
 */
export default function ChartDataTable<Row>({
  caption,
  columns,
  rows,
  rowKey = (_row, index) => index,
}: Props<Row>) {
  return (
    <div className="chart-data-table chart-data-table--visually-hidden">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) =>
                column.rowHeader ? (
                  <th key={column.key} scope="row">{column.render(row)}</th>
                ) : (
                  <td key={column.key}>{column.render(row)}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
