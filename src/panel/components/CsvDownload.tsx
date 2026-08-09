import { Button } from '@/components/ui/button';

interface CsvDownloadProps {
  onExportCSV: () => void;
}

export default function CsvDownload({ onExportCSV }: CsvDownloadProps) {
  return (
    <section className="mt-6 space-y-2">
      <h2 className="text-sm font-medium text-foreground">CSV download</h2>
      <p className="text-xs text-muted-foreground">
        Download every recorded lead as a .csv file.
      </p>
      <Button variant="outline" className="w-full" onClick={onExportCSV}>
        Download CSV
      </Button>
    </section>
  );
}
