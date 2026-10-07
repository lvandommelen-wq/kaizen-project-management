import Link from "next/link";
import { type Project, projectStageLabels } from "@/lib/projects";

type ProjectFormProps = {
  action: (formData: FormData) => void;
  project?: Project;
  submitLabel: string;
};

export function ProjectForm({ action, project, submitLabel }: ProjectFormProps) {
  return (
    <form action={action} className="space-y-8">
      <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2">
        <Field label="Project number" name="projectNumber" required defaultValue={project?.projectNumber} />
        <Field label="Project name" name="name" required defaultValue={project?.name} />
        <Field label="Project manager" name="projectManager" required defaultValue={project?.projectManager} />
        <Field label="Reports to" name="reportsTo" required defaultValue={project?.reportsTo} />
        <Field label="Customer" name="customer" required defaultValue={project?.customer} />
        <Field label="Site / location" name="siteLocation" required defaultValue={project?.siteLocation} />

        <Field label="Planned start date" name="plannedStartDate" type="date" defaultValue={project?.plannedStartDate} />
        <Field label="Planned completion date" name="plannedCompletionDate" type="date" defaultValue={project?.plannedCompletionDate} />

        {!project ? (
          <>
            <fieldset className="grid gap-3 text-sm font-medium text-slate-700">
              <legend>Validation required</legend>
              <div className="flex gap-4 text-sm font-normal text-slate-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    name="validationRequired"
                    type="radio"
                    value="yes"
                    className="size-4 accent-slate-900"
                  />
                  Yes
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    name="validationRequired"
                    type="radio"
                    value="no"
                    defaultChecked
                    className="size-4 accent-slate-900"
                  />
                  No
                </label>
              </div>
            </fieldset>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              New Projects start in <span className="font-semibold text-slate-900">{projectStageLabels.initiation}</span>.
            </div>
          </>
        ) : null}

        <label className="grid gap-2 text-sm font-medium text-slate-700 md:col-span-2">
          Description
          <textarea
            name="description"
            rows={5}
            defaultValue={project?.description}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-950 shadow-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200"
          />
        </label>
      </section>

      <div className="flex items-center justify-end gap-3">
        <Link href={project ? `/projects/${project.id}` : "/projects"} className="button-secondary">
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
