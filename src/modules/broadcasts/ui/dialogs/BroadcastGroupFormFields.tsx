import React from 'react';
import { Input } from '@/modules/core/ui/primitives/input';

export interface BroadcastGroupFormFieldsProps {
    name: string;
    onNameChange: (value: string) => void;
    description: string;
    onDescriptionChange: (value: string) => void;
    disabled?: boolean;
}

export const BroadcastGroupFormFields: React.FC<BroadcastGroupFormFieldsProps> = ({
    name,
    onNameChange,
    description,
    onDescriptionChange,
    disabled = false,
}) => {
    return (
        <>
            <div className="space-y-2">
                <label htmlFor="group-name" className="text-sm font-medium">Group Name</label>
                <Input
                    id="group-name"
                    placeholder="Enter group name"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    disabled={disabled}
                />
            </div>
            <div className="space-y-2">
                <label htmlFor="group-description" className="text-sm font-medium">Description (optional)</label>
                <Input
                    id="group-description"
                    placeholder="Enter description"
                    value={description}
                    onChange={(e) => onDescriptionChange(e.target.value)}
                    disabled={disabled}
                />
            </div>
        </>
    );
};
