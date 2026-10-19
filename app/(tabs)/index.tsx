import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MotionPressable from '@/components/MotionPressable';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AppButton from '@/components/AppButton';
import EventQRCode from '@/components/EventQRCode';
import StatusBadge from '@/components/StatusBadge';
import { COLORS } from '@/constants/colors';
import { FONTS } from '@/constants/fonts';
import { useAuth } from '@/lib/auth';
import { getDiscoveryEvents, getEventCreatorNames, type DiscoveryEvent } from '@/lib/events';
import { getProfileWithError, type Role } from '@/lib/profiles';
import { formatEventDate, formatEventTimeRange } from '@/lib/formatters';
import {
  subscribeToSupabaseDataChanges,
  subscribeToSupabaseRealtimeStatus,
} from '@/lib/supabaseRealtime';

type Filter = 'all' | 'open' | 'closed' | 'attended';
type SortBy = 'date' | 'name';

export default function HomeScreen() {
  const { user, session } = useAuth();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [events, setEvents] = useState<DiscoveryEvent[]>([]);
  const [eventCreatorNames, setEventCreatorNames] = useState<Record<string, string>>({});
  const [role, setRole] = useState<Role | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuProgress = useRef(new Animated.Value(0)).current;
  const [selected, setSelected] = useState<DiscoveryEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveUpdateError, setLiveUpdateError] = useState(false);

  useEffect(() => {
    sortMenuProgress.stopAnimation();
    if (reduceMotion === false) {
      Animated.timing(sortMenuProgress, {
        toValue: sortMenuOpen ? 1 : 0,
        duration: 160,
        easing: sortMenuOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      sortMenuProgress.setValue(sortMenuOpen ? 1 : 0);
    }
  }, [reduceMotion, sortMenuOpen, sortMenuProgress]);

  const load = useCallback(async (refresh = false, background = false) => {
    if (refresh) setRefreshing(true);
    else if (!background) setLoading(true);
    setLoadError(null);
    try {
      if (!user) throw new Error('Sign in to load campus events.');
      if (!session?.access_token) throw new Error('Your sign-in session is missing. Please sign in again.');
      const { profile: loadedProfile, error: profileError } = await getProfileWithError(user.id, session?.access_token);
      if (profileError) throw new Error(`Unable to load your account profile: ${profileError}`);
      if (!loadedProfile) throw new Error('No Acadence profile was found for this account.');
      setRole(loadedProfile.role);
      const discovered = await getDiscoveryEvents(
        loadedProfile.role === 'student' ? user.id : undefined,
        session.access_token,
      );
      setEvents(discovered);
      if (loadedProfile.role === 'admin') {
        try {
          const creatorNames = await getEventCreatorNames(
            discovered.map((event) => event.created_by ?? ''),
            session.access_token,
          );
          setEventCreatorNames(creatorNames);
        } catch (error) {
          console.error('Unable to load event creator names for the administrator.', error);
          setEventCreatorNames({});
          setLoadError('Event creator names could not be loaded. Pull down to retry.');
        }
      } else {
        setEventCreatorNames({});
      }
    } catch (error) {
      if (!refresh && !background) setEvents([]);
      setLoadError(error instanceof Error ? error.message : 'Unable to load events. Please try again.');
    } finally {
      if (!background) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [session?.access_token, user]);
  useFocusEffect(useCallback(() => {
    void load();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToSupabaseDataChanges(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void load(false, true); }, 200);
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [load]));

  useEffect(() => {
    return subscribeToSupabaseRealtimeStatus((connected) => setLiveUpdateError(!connected));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const updatedSelection = events.find((event) => event.id === selected.id);
    if (updatedSelection && updatedSelection !== selected) setSelected(updatedSelection);
  }, [events, selected]);

  const visibleEvents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = events.filter((event) => {
      const matchesSearch = !needle || event.title.toLowerCase().includes(needle) || event.event_code.toLowerCase().includes(needle);
      const matchesFilter = filter === 'all' || (filter === 'open' && event.status === 'open') || (filter === 'closed' && event.status === 'closed') || (filter === 'attended' && event.attended);
      return matchesSearch && matchesFilter;
    });
    return filtered.sort((left, right) => sortBy === 'name'
      ? left.title.localeCompare(right.title)
      : (new Date(right.start_time ?? right.created_at).getTime() - new Date(left.start_time ?? left.created_at).getTime()));
  }, [events, filter, search, sortBy]);
  return <View style={styles.container}>
    <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>Discover Events</Text>
      <Text style={styles.subtitle}>Find what’s happening around campus.</Text>
    </View>
    <View style={[styles.controls, sortMenuOpen && styles.controlsMenuOpen]}>
      <View style={[styles.searchBox, sortMenuOpen && styles.searchBoxMenuOpen]}>
        <Ionicons name="search-outline" size={19} color={COLORS.primaryLight} style={styles.searchIcon} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search events" placeholderTextColor={COLORS.textMuted} accessibilityLabel="Search by event title or code" />
        {!!search && <MotionPressable style={styles.searchClearButton} onPress={() => setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search"><Ionicons name="close-circle" size={19} color={COLORS.textSecondary} /></MotionPressable>}
        <View style={[styles.sortControlWrap, sortMenuOpen && styles.sortControlOpen]}>
          <MotionPressable
            style={({ pressed }) => [styles.sortDropdown, pressed && styles.sortDropdownPressed]}
            onPress={() => setSortMenuOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={`Sort events by ${sortBy === 'date' ? 'date' : 'name A to Z'}`}
            accessibilityState={{ expanded: sortMenuOpen }}
          >
            <Ionicons name="swap-vertical" size={19} color={COLORS.primaryLight} />
          </MotionPressable>
          <Animated.View
            pointerEvents={sortMenuOpen ? 'auto' : 'none'}
            accessibilityElementsHidden={!sortMenuOpen}
            importantForAccessibility={sortMenuOpen ? 'auto' : 'no-hide-descendants'}
            style={[
              styles.sortMenu,
              {
                opacity: sortMenuProgress,
                transform: [{
                  translateY: sortMenuProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-5, 0],
                  }),
                }, {
                  scale: sortMenuProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.98, 1],
                  }),
                }],
              },
            ]}
          >
            {(['date', 'name'] as const).map((option) => {
              const selectedSort = sortBy === option;
              return <MotionPressable
                key={option}
                style={({ pressed }) => [
                  styles.sortOption,
                  selectedSort && styles.sortOptionSelected,
                  pressed && styles.sortOptionPressed,
                ]}
                onPress={() => { setSortBy(option); setSortMenuOpen(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected: selectedSort }}
              >
                <Text style={[styles.sortOptionText, selectedSort && styles.sortOptionTextSelected]}>{option === 'date' ? 'Date' : 'Name (A-Z)'}</Text>
                {selectedSort && <Ionicons name="checkmark" size={15} color={COLORS.primaryLight} />}
              </MotionPressable>;
            })}
          </Animated.View>
        </View>
      </View>
      <ScrollView
        horizontal
        style={styles.filterScroll}
        contentContainerStyle={styles.filterGroup}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {(['all', 'open', 'closed', ...(role === 'student' ? ['attended'] : [])] as Filter[]).map((item) => {
          const active = filter === item;
          const label = item === 'all' ? 'All Events' : item === 'attended' ? 'My Attendance' : item === 'open' ? 'Open' : 'Closed';
          return <MotionPressable
            key={item}
            style={({ pressed }) => [styles.filter, active && styles.filterActive, pressed && styles.filterPressed]}
            onPress={() => { setFilter(item); setSortMenuOpen(false); }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Filter events: ${label}`}
          >
            <Text style={[styles.filterText, active && styles.filterTextActive]} numberOfLines={1}>{label}</Text>
          </MotionPressable>;
        })}
      </ScrollView>
    </View>
    {loading ? <View style={styles.state}><ActivityIndicator color={COLORS.primary} /><Text style={styles.stateText}>Loading events...</Text></View> : <>
      {liveUpdateError && <View style={styles.refreshError}><Text style={styles.stateText}>Live attendance updates are unavailable. Pull down to refresh.</Text></View>}
      {!!loadError && events.length > 0 && <View style={styles.refreshError}><Text style={styles.stateText}>{loadError}</Text><MotionPressable style={styles.clearFilters} onPress={() => load(true)} accessibilityRole="button"><Text style={styles.clearFiltersText}>Try again</Text></MotionPressable></View>}
      <FlatList data={visibleEvents} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />} ListEmptyComponent={<View style={styles.emptyCard}><Text style={styles.stateTitle}>{loadError ? 'Could not load events' : events.length ? 'No matching events' : 'No events available'}</Text><Text style={styles.stateText}>{loadError ?? (events.length ? 'Try another search or filter.' : 'Check back later for upcoming school events.')}</Text>{loadError ? <MotionPressable style={styles.clearFilters} onPress={() => load()} accessibilityRole="button"><Text style={styles.clearFiltersText}>Try again</Text></MotionPressable> : (search || filter !== 'all') && <MotionPressable style={styles.clearFilters} onPress={() => { setSearch(''); setFilter('all'); }} accessibilityRole="button"><Text style={styles.clearFiltersText}>Clear search and filters</Text></MotionPressable>}</View>} renderItem={({ item }) => <EventCard event={item} creatorName={role === 'admin' ? eventCreatorNames[item.created_by ?? ''] ?? 'Creator unavailable' : undefined} onPress={() => setSelected(item)} />}
      />
    </>}
    <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
      {selected && <ScrollView
        style={styles.modalScroll}
        contentContainerStyle={[styles.modal, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 16) + 20 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.modalHeader}>
          <View style={styles.modalHeading}>
            <View style={styles.modalTitleGroup}>
              <Text style={styles.modalTitle}>{selected.title}</Text>
              <Text style={styles.modalCode}>{selected.event_code}</Text>
            </View>
          </View>
          <MotionPressable style={styles.modalClose} onPress={() => setSelected(null)} accessibilityRole="button" accessibilityLabel="Close event details">
            <Ionicons name="close" size={21} color={COLORS.textPrimary} />
          </MotionPressable>
        </View>
        <View style={styles.modalDetails}>
          <View style={styles.modalDetailRow}><Ionicons name="time-outline" size={17} color={COLORS.textSecondary} /><Text style={styles.detailRowText}>{formatEventTime(selected)}</Text></View>
          {selected.venue && <View style={styles.modalDetailRow}><Ionicons name="location-outline" size={17} color={COLORS.textSecondary} /><Text style={styles.detailRowText}>Venue · {selected.venue}</Text></View>}
          {role === 'admin' && (
            <View style={styles.modalDetailRow}>
              <Ionicons name="person-outline" size={17} color={COLORS.textSecondary} />
              <Text style={styles.detailRowText}>Created by {eventCreatorNames[selected.created_by ?? ''] ?? 'Creator unavailable'}</Text>
            </View>
          )}
        </View>
        {selected.description && <Text style={[styles.description, styles.modalDescription]}>{selected.description}</Text>}
        <View style={styles.modalStatusRow}>
          <StatusBadge status={selected.status} label={selected.status === 'open' ? 'Open for attendance' : 'Closed'} />
          {selected.attended && <Text style={[styles.attended, selected.attendanceStatus === 'late' && styles.attendedLate]}>{selected.attendanceStatus === 'late' ? 'Checked in late' : 'Attended'}</Text>}
        </View>
        {selected.status === 'open' && role === 'student' && !selected.attended && <AppButton theme="primary" title="Open Scanner" icon="qr-code-outline" onPress={() => { setSelected(null); router.push('/scan'); }} />}
        {(role === 'admin' || (role === 'teacher' && selected.created_by === user?.id)) && <>
          <View style={styles.modalManageAction}>
            <AppButton title="Manage Event" icon="create-outline" onPress={() => { setSelected(null); router.push({ pathname: '/event-edit', params: { eventId: selected.id } }); }} compact />
          </View>
          {selected.status === 'open' && !selected.archived_at && <EventQRCode event={selected} compact />}
        </>}
      </ScrollView>}
    </Modal>
  </View>;
}

function EventCard({ event, creatorName, onPress }: { event: DiscoveryEvent; creatorName?: string; onPress: () => void }) {
  const isOpen = event.status === 'open';
  const eventDate = formatEventDate(event.start_time);
  return (
    <MotionPressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${event.title}, ${isOpen ? 'open' : 'closed'}${creatorName ? `, created by ${creatorName}` : ''}`}>
      <View style={styles.cardTop}>
        <View style={styles.cardHeading}>
          <Text style={styles.cardTitle} numberOfLines={2}>{event.title}</Text>
          <Text style={styles.code}>{event.event_code}</Text>
          {creatorName && <Text style={styles.creatorName} numberOfLines={1}>Created by {creatorName}</Text>}
        </View>
        <StatusBadge status={event.status} shape="subtle" />
      </View>
      <View style={styles.cardDivider} />
      {eventDate && <View style={styles.detailRow}><Ionicons name="calendar-outline" size={16} color={COLORS.textSecondary} /><Text style={styles.detail}>{eventDate}</Text></View>}
      <View style={styles.detailRow}><Ionicons name="time-outline" size={16} color={COLORS.textSecondary} /><Text style={styles.detail}>{formatEventTime(event)}</Text></View>
      {event.venue && <View style={styles.detailRow}><Ionicons name="location-outline" size={16} color={COLORS.textSecondary} /><Text style={styles.detail} numberOfLines={1}>Venue · {event.venue}</Text></View>}
      {event.description && <EventDescription description={event.description} />}
      {event.attended && <View style={styles.attendedRow}>
        <Ionicons name="checkmark-circle" size={14} color={event.attendanceStatus === 'late' ? COLORS.warning : COLORS.success} />
        <Text style={[styles.attended, event.attendanceStatus === 'late' && styles.attendedLate]}>
          {event.attendanceStatus === 'late' ? 'You checked in late' : 'You attended this event'}
        </Text>
      </View>}
      <View style={styles.cardFooter}><Text style={styles.viewDetails}>View details</Text></View>
    </MotionPressable>
  );
}

function EventDescription({ description }: { description: string }) {
  const [width, setWidth] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.descriptionContainer} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Text style={styles.description} numberOfLines={expanded ? undefined : 2}>{description}</Text>
      {width > 0 && <Text
        style={[styles.description, styles.descriptionMeasure, { width }]}
        onTextLayout={(event) => setHasMore(event.nativeEvent.lines.length > 2)}
        accessible={false}
      >{description}</Text>}
      {hasMore && <MotionPressable
        style={styles.readMoreButton}
        onPress={(event) => {
          event.stopPropagation();
          setExpanded((current) => !current);
        }}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={5}
      >
        <Text style={styles.readMoreText}>{expanded ? 'Show less' : 'Read more'}</Text>
      </MotionPressable>}
    </View>
  );
}

function formatEventTime(event: DiscoveryEvent) {
  return formatEventTimeRange(event.start_time, event.end_time);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 22, paddingBottom: 16 },
  title: { color: COLORS.textPrimary, fontSize: 24, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: -0.35 },
  subtitle: { color: COLORS.textSecondary, fontSize: 14, fontFamily: FONTS.regular, marginTop: 5, lineHeight: 20 },
  controls: { paddingHorizontal: 22, paddingBottom: 2 },
  controlsMenuOpen: { position: 'relative', zIndex: 20, elevation: 20 },
  searchBox: { minHeight: 52, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, paddingLeft: 15, paddingRight: 10, zIndex: 2 },
  searchBoxMenuOpen: { zIndex: 10, elevation: 10 },
  searchIcon: { marginRight: 12 },
  searchInput: { flex: 1, minWidth: 0, color: COLORS.textPrimary, paddingVertical: 12, fontSize: 14, fontFamily: FONTS.regular },
  searchClearButton: { width: 38, height: 42, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  filterScroll: { marginTop: 14, marginBottom: 8, flexGrow: 0 },
  filterGroup: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingRight: 2 },
  filter: { minHeight: 40, flexShrink: 0, justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, paddingHorizontal: 14, backgroundColor: COLORS.card },
  filterActive: { backgroundColor: COLORS.primaryButtonStart, borderColor: COLORS.primaryButtonStart },
  filterPressed: { opacity: 0.76 },
  filterText: { color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', fontFamily: FONTS.semiBold },
  filterTextActive: { color: COLORS.textOnPrimary },
  sortControlWrap: { position: 'relative', flexShrink: 0, marginLeft: 12, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: COLORS.border, zIndex: 3 },
  sortControlOpen: { zIndex: 11, elevation: 11 },
  sortDropdown: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  sortDropdownPressed: { opacity: 0.78, backgroundColor: COLORS.surfaceRaised },
  sortMenu: { position: 'absolute', top: 43, right: -5, width: 148, padding: 5, borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, backgroundColor: COLORS.card, zIndex: 12, elevation: 12, shadowColor: COLORS.shadow, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.28, shadowRadius: 12 },
  sortOption: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 7, paddingHorizontal: 10 },
  sortOptionSelected: { backgroundColor: `${COLORS.primary}24` },
  sortOptionPressed: { backgroundColor: COLORS.surfaceRaised },
  sortOptionText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONTS.medium },
  sortOptionTextSelected: { color: COLORS.primaryLight, fontFamily: FONTS.semiBold },
  list: { paddingHorizontal: 22, paddingTop: 8, paddingBottom: 30 },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 11, padding: 14, marginBottom: 14, overflow: 'hidden' },
  cardPressed: { opacity: 0.88 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  cardHeading: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { color: COLORS.textPrimary, fontSize: 16, lineHeight: 21, fontWeight: '700', fontFamily: FONTS.bold, letterSpacing: -0.15 },
  code: { color: COLORS.primary, fontSize: 12, lineHeight: 16, fontWeight: '600', fontFamily: FONTS.semiBold, letterSpacing: 0.2 },
  creatorName: { color: COLORS.textSecondary, fontSize: 11, lineHeight: 15, fontFamily: FONTS.regular, marginTop: 2 },
  cardDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  detail: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17, flexShrink: 1 },
  detailRowText: { color: COLORS.textSecondary, fontSize: 13, fontFamily: FONTS.regular, lineHeight: 19, flex: 1 },
  descriptionContainer: { position: 'relative', marginTop: 8 },
  description: { color: COLORS.textSecondary, fontSize: 12, fontFamily: FONTS.regular, lineHeight: 17 },
  descriptionMeasure: { position: 'absolute', top: 0, left: 0, opacity: 0 },
  readMoreButton: { alignSelf: 'flex-start', minHeight: 28, justifyContent: 'center', paddingRight: 8 },
  readMoreText: { color: COLORS.primary, fontSize: 11, fontWeight: '600', fontFamily: FONTS.semiBold },
  attendedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  attended: { color: COLORS.success, fontSize: 11, fontWeight: '600', fontFamily: FONTS.semiBold },
  attendedLate: { color: COLORS.warning },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: 10, paddingTop: 9 },
  viewDetails: { color: COLORS.primary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold },
  state: { alignItems: 'center', justifyContent: 'center', padding: 36 },
  refreshError: { marginHorizontal: 22, marginBottom: 8, padding: 10, alignItems: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 9 },
  emptyCard: { alignItems: 'center', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 20, marginTop: 8 },
  stateTitle: { color: COLORS.textPrimary, fontWeight: '700', textAlign: 'center', fontSize: 15 },
  stateText: { color: COLORS.textSecondary, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  clearFilters: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  clearFiltersText: { color: COLORS.primary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold },
  modalScroll: { flex: 1, backgroundColor: COLORS.background },
  modal: { flexGrow: 1, backgroundColor: COLORS.background, paddingHorizontal: 22, paddingTop: 24 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20 },
  modalHeading: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalTitleGroup: { flex: 1 },
  modalTitle: { color: COLORS.textPrimary, fontSize: 21, fontWeight: '800', fontFamily: FONTS.extraBold, letterSpacing: -0.3 },
  modalCode: { color: COLORS.primary, fontSize: 12, fontWeight: '600', fontFamily: FONTS.semiBold, marginTop: 4 },
  modalClose: { width: 44, height: 44, borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center' },
  modalDetails: { gap: 11, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 15, padding: 14 },
  modalDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  modalDescription: { marginTop: 12 },
  modalStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  modalManageAction: { marginTop: 10 },
});
