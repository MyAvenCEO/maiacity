let revision = $state(0);
export const session = { get revision() { return revision; } };
export const bump = () => revision++;
