const chips = ['全部', '今天', '明天', '06/14 周日', '06/15 周一'];

interface DateChipsProps {
  value: string;
  onChange: (value: string) => void;
}

export function DateChips({ value, onChange }: DateChipsProps) {
  return (
    <div className="dateChips" aria-label="日期筛选">
      {chips.map((chip) => (
        <button className={`dateChip ${value === chip ? 'active' : ''}`} key={chip} onClick={() => onChange(chip)}>
          {chip}
        </button>
      ))}
    </div>
  );
}
