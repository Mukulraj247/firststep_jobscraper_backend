import React from 'react';
import { FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import type { PersonaKey } from '../mock/mockPersonas';
import { FIRSTSTEP, RADIUS } from '../tokens';

type Props = {
  value: PersonaKey;
  onChange: (persona: PersonaKey) => void;
};

export function DemoPersonaSwitcher({ value, onChange }: Props) {
  return (
    <Stack spacing={1.25} sx={{ p: 2, borderRadius: RADIUS.card, bgcolor: FIRSTSTEP.surface, border: `1px dashed ${FIRSTSTEP.border}` }}>
      <Typography variant="caption" sx={{ color: FIRSTSTEP.textMuted, fontWeight: 700, letterSpacing: '0.06em' }}>
        DEMO PERSONA SWITCHER (DEV ONLY)
      </Typography>
      <FormControl size="small" fullWidth>
        <InputLabel>Persona</InputLabel>
        <Select label="Persona" value={value} onChange={(e) => onChange(e.target.value as PersonaKey)}>
          <MenuItem value="priya">Priya — Student (FAANG @ 2h)</MenuItem>
          <MenuItem value="marcus">Marcus — Professional (Google + Consulting)</MenuItem>
        </Select>
      </FormControl>
    </Stack>
  );
}
