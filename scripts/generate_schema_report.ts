
import fs from 'fs';
import path from 'path';

interface Column {
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
}

interface Relationship {
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
    constraint_name: string;
}

interface FunctionDef {
    function_name: string;
    arguments: string;
    result_type: string;
    comment: string;
}

interface Schema {
    columns: Column[];
    relationships: Relationship[];
    functions: FunctionDef[];
}

function generateMarkdown(schema: Schema): string {
    let md = '# Database Schema Documentation\n\n';
    md += `Generated on: ${new Date().toISOString()}\n\n`;

    // 1. Tables
    md += '## Tables\n\n';

    // Group columns by table
    const tables: Record<string, Column[]> = {};
    schema.columns.forEach(col => {
        if (!tables[col.table_name]) tables[col.table_name] = [];
        tables[col.table_name].push(col);
    });

    for (const [tableName, cols] of Object.entries(tables)) {
        md += `### ${tableName}\n`;
        md += '| Column | Type | Nullable |\n';
        md += '| --- | --- | --- |\n';
        cols.forEach(c => {
            md += `| ${c.column_name} | ${c.data_type} | ${c.is_nullable} |\n`;
        });
        md += '\n';

        // Add relationships for this table
        const rels = schema.relationships.filter(r => r.table_name === tableName);
        if (rels.length > 0) {
            md += '**Foreign Keys:**\n';
            rels.forEach(r => {
                md += `- \`${r.column_name}\` -> \`${r.foreign_table_name}.${r.foreign_column_name}\` (${r.constraint_name})\n`;
            });
            md += '\n';
        }
    }

    // 2. RPCs / Functions
    md += '## Functions (RPCs)\n\n';
    md += '| Function Name | Arguments | Returns | Description |\n';
    md += '| --- | --- | --- | --- |\n';

    schema.functions.forEach(f => {
        const desc = f.comment ? f.comment.replace(/\n/g, ' ') : '-';
        md += `| ${f.function_name} | ${f.arguments} | ${f.result_type} | ${desc} |\n`;
    });

    return md;
}

const jsonPath = path.join(process.cwd(), 'schema_dump.json');
const rawData = fs.readFileSync(jsonPath, 'utf8');
const schema: Schema = JSON.parse(rawData);

const markdown = generateMarkdown(schema);

// Write to active brain directory or just root for user? 
// User asked for it, sending to artifact path.
// Actually, `active_mode_overview` says write artifacts to <appDataDir>/brain/<conversation-id>...
// But I need to know that path. 
// I will output to root for now and then copy/move or notify via `notify_user` with the content if small enough, OR just save to a known location.
// The user has a workspace at `c:\Users\vinay\OneDrive\Desktop\Superman`.
// I will put it there as `DATABASE_SCHEMA.md`.

const outPath = path.join(process.cwd(), 'DATABASE_SCHEMA.md');
fs.writeFileSync(outPath, markdown);
console.log(`Report generated at: ${outPath}`);
