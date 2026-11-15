# Checks

Refusals identify the object, the observed value and the required value.
See [AUTHORING](AUTHORING.md#6-refusals-the-rule-and-what-has-to-change) for the full
command reference.

## Edited rig-space parts

The following checks apply only when `assemble.edited_parts` is declared.
They run before output emission; refusal preserves a missing output directory
and all files in a preexisting successful output.

| Code | Refuses | Remedy |
| --- | --- | --- |
| `ASSEMBLE_EDITED_PART_UNKNOWN` | A receipt names a part outside the base plan. | Use the existing base-plan part name; a new name needs a plan change. |
| `ASSEMBLE_EDITED_PART_FILE` | The receipt file does not exist at dir/file. | Correct the config-relative dir or the directory-relative file, or supply that file. |
| `ASSEMBLE_EDITED_PART_SHA256` | The edited file bytes do not match sha256. | Use the intended edited file and record its exact file hash. |
| `ASSEMBLE_EDITED_PART_BASELINE` | The current normal assembled part PNG does not match from_sha256. | Rebase the edit on this config's current assembled part and record that original file hash. |
| `ASSEMBLE_EDITED_PART_SIZE` | The edited PNG width or height differs from the assembled box. | Edit at the original crop and rig-pixel size; use a plan change for a new box. |
| `ASSEMBLE_EDITED_PART_DUPLICATE` | More than one receipt names the same part. | Keep exactly one receipt for that part. |
| `ASSEMBLE_EDITED_PART_DECODES` | The verified file cannot be decoded as a PNG. | Supply a valid PNG and update its receipt hash. |

Malformed block and receipt fields use the config loader's `CONFIG_FIELD_TYPE`,
`CONFIG_FIELD_PRESENT` or `CONFIG_KEY_KNOWN` checks. Metadata uses the strict
parts reader's `PARTS_FIELD_TYPE` and `PARTS_COUNTS_ADD_UP` checks for the receipt
association and its census. See [the field contract](AUTHORING.md#edited-rig-space-parts-assembleedited_parts-issue-1278).
