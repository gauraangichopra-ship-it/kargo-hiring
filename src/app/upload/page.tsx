import UploadQueue from "@/components/UploadQueue";

export default function UploadPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Upload CVs</h1>
        <p className="text-sm text-muted">
          Name, email, phone, links and institution names are removed before any AI sees the CV. Nothing is emailed from here.
        </p>
      </div>
      <UploadQueue />
    </div>
  );
}
