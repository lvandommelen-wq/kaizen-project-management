import Link from "next/link";
import {
  packageExecutionModelLabels,
  packageExecutionModels,
  packageStageLabels,
  type ProjectPackage,
} from "@/lib/packages";

type PackageFormProps = {
  action: (formData: FormData) => void;
  projectId: string;
  projectPackage?: ProjectPackage;
  submitLabel: string;
};

export function PackageForm({ action, projectId, projectPackage, submitLabel }: PackageFormProps) {
  return (
    <form action={action} className="space-y-8">
      <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <Field label="Package Code" name="packageCode" required defaultValue={projectPackage?.packageCode} />
        <Field label="Package Name" name="packageName" required defaultValue={projectPackage?.packageName} />
        <Field label="Package Owner" name="packageOwner" required defaultValue={projectPackage?.packageOwner} />

        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Execution Model
          <select
            name="executionModel"
            defaultValue={projectPackage?.executionModel ?? ""}
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          >
            <option value="">Not determined</option>
            {packageExecutionModels.map((executionModel) => (
              <option key={executionModel} value={executionModel}>
                {packageExecutionModelLabels[executionModel]}
              </option>
            ))}
          </select>
        </label>

        {!projectPackage ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 md:col-span-2">
            New Packages start in <span className="font-semibold text-slate-900">{packageStageLabels.definition}</span>.
          </div>
        ) : null}

        <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
          Description
          <textarea
            name="description"
            rows={5}
            defaultValue={projectPackage?.description}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </label>
      </section>

      <div className="flex items-center justify-end gap-3">
        <Link
          href={projectPackage ? `/projects/${projectId}/packages/${projectPackage.id}` : `/projects/${projectId}`}
          className="button-secondary"
        >
          Cancel
        </Link>
        <button type="submit" className="button-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

type FieldProps = {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  type?: string;
};

function Field({ label, name, defaultValue, required, type = "text" }: FieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-700">
      {label}
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
      />
    </label>
  );
}
