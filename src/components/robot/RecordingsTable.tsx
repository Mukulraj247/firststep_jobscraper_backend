import { ScrapersPage, type ScrapersPageProps } from '../../features/scrapers/ScrapersPage';

export type RecordingsTableProps = ScrapersPageProps & {
  handleEditRecording?: (id: string, fileName: string) => void;
};

/** @deprecated Use ScrapersPage from features/scrapers */
export const RecordingsTable = (props: RecordingsTableProps) => <ScrapersPage {...props} />;

export { ScrapersPage };
