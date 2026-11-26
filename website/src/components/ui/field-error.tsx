// The red line under a form field — one implementation for every form.
//
// The `id` is the other half of the contract: the control renders
// `aria-describedby="<id>"` (and `aria-invalid` when it has errors), the
// `FieldError` renders that id on the message. Without the pair a screen reader
// reaches the input and never hears why it was rejected — the text is on screen
// and invisible to the accessibility tree.
//
// Callers own both sides, e.g.:
//
//   <Input id="name" aria-invalid={Boolean(errors.name?.length)}
//          aria-describedby={errors.name?.length ? 'name-error' : undefined} />
//   <FieldError id="name-error" errors={errors.name} />

export function FieldError({ id, errors }: { id: string; errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {errors[0]}
    </p>
  );
}
