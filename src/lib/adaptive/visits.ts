export function createSectionVisitDeduper<TFeature extends string>() {
  const lastFeatureByUser = new Map<string, TFeature>()
  const lastNavigationByUser = new Map<string, string>()

  return {
    shouldRecord(userId: string, feature: TFeature, navigationKey: string) {
      if (lastNavigationByUser.get(userId) === navigationKey) return false
      lastNavigationByUser.set(userId, navigationKey)
      if (lastFeatureByUser.get(userId) === feature) return false
      lastFeatureByUser.set(userId, feature)
      return true
    }
  }
}
